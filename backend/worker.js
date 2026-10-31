import 'dotenv/config';
import {
    JOB_MAX_ATTEMPTS,
    claimNextJob,
    completeJob,
    listenForJobs,
    releaseJob,
} from './utils/jobQueue.js';
import { processPhotoJob } from './workers/photoJobProcessor.js';
import { startSoftDeleteSweeper } from './workers/softDeleteSweeper.js';
import { startGalleryCacheRefresher } from './workers/galleryCacheRefresher.js';

const RETRY_DELAY_DEFAULT_MS = 3000;
const rawRetryDelayMs = Number(
    process.env.PHOTO_WORKER_RETRY_MS || RETRY_DELAY_DEFAULT_MS,
);
const retryDelayMs =
    Number.isFinite(rawRetryDelayMs) && rawRetryDelayMs > 0
        ? Math.floor(rawRetryDelayMs)
        : RETRY_DELAY_DEFAULT_MS;
// страховка на случай пропущенного NOTIFY (например, во время переподключения)
const POLL_INTERVAL_MS = 30 * 1000;

let isShuttingDown = false;
let stopSoftDeleteSweeper = null;
let stopGalleryCacheRefresher = null;
let stopListening = null;
let pollTimer = null;
let currentJobId = null;
let draining = false;
let drainRequested = false;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function runJob(job) {
    const payload = job.payload || {};
    const jobType = String(payload.jobType || 'photo-upload');

    if (job.attempts > JOB_MAX_ATTEMPTS) {
        console.error('[photo-worker] Job exceeded attempts, dropping', {
            id: job.id,
            jobType,
        });
        await completeJob(job.id);
        return;
    }

    currentJobId = job.id;
    try {
        const result = await processPhotoJob(payload);
        if (jobType !== 'photo-upload') {
            console.log('[photo-worker] Job completed', { jobType, result });
        }
    } catch (err) {
        // Do not retry invalid/unprocessable data forever.
        console.error('[photo-worker] Photo processing failed:', err);
    } finally {
        currentJobId = null;
    }

    // задача отработала (успешно или с ошибкой) — удаляем, как ack в RabbitMQ
    await completeJob(job.id);
}

// Обрабатываем задачи по одной, пока очередь не опустеет.
async function drainQueue() {
    if (draining) {
        drainRequested = true;
        return;
    }
    draining = true;
    try {
        do {
            drainRequested = false;
            while (!isShuttingDown) {
                const job = await claimNextJob();
                if (!job) {
                    break;
                }
                await runJob(job);
            }
        } while (drainRequested && !isShuttingDown);
    } catch (err) {
        console.error('[photo-worker] Queue error:', err.message);
    } finally {
        draining = false;
    }
}

async function subscribe() {
    while (!isShuttingDown) {
        try {
            stopListening = await listenForJobs(
                () => void drainQueue(),
                (err) => {
                    console.error(
                        '[photo-worker] Queue listener lost:',
                        err.message,
                    );
                    stopListening = null;
                    if (!isShuttingDown) {
                        void sleep(retryDelayMs).then(subscribe);
                    }
                },
            );
            console.log('[photo-worker] Listening for jobs in PostgreSQL');
            void drainQueue();
            return;
        } catch (err) {
            console.error(
                `[photo-worker] PostgreSQL unavailable. Retry in ${retryDelayMs}ms.`,
                err.message,
            );
            await sleep(retryDelayMs);
        }
    }
}

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    console.log(`[photo-worker] Received ${signal}, shutting down...`);

    if (pollTimer) {
        clearInterval(pollTimer);
    }
    for (const stop of [
        stopSoftDeleteSweeper,
        stopGalleryCacheRefresher,
        stopListening,
    ]) {
        if (!stop) {
            continue;
        }
        try {
            await stop();
        } catch (err) {
            console.error(
                '[photo-worker] Failed to stop background task:',
                err,
            );
        }
    }

    // незавершённую задачу возвращаем в очередь, её возьмёт следующий запуск
    if (currentJobId) {
        try {
            await releaseJob(currentJobId);
        } catch (err) {
            console.error('[photo-worker] Failed to release job:', err.message);
        }
    }
    process.exit(0);
}

process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
});
process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
});

async function main() {
    stopSoftDeleteSweeper = startSoftDeleteSweeper();
    stopGalleryCacheRefresher = startGalleryCacheRefresher();
    pollTimer = setInterval(() => void drainQueue(), POLL_INTERVAL_MS);
    await subscribe();
}

main().catch((err) => {
    console.error('[photo-worker] Fatal worker loop error:', err);
    process.exit(1);
});
