import 'dotenv/config';
import { createPhotoConsumerChannel } from './utils/rabbitmq.js';
import { processPhotoJob } from './workers/photoJobProcessor.js';
import { startSoftDeleteSweeper } from './workers/softDeleteSweeper.js';

const PREFETCH_DEFAULT = 1;
const rawPrefetch = Number(
    process.env.PHOTO_WORKER_PREFETCH || PREFETCH_DEFAULT,
);
const prefetch =
    Number.isInteger(rawPrefetch) && rawPrefetch > 0
        ? rawPrefetch
        : PREFETCH_DEFAULT;

const RETRY_DELAY_DEFAULT_MS = 3000;
const rawRetryDelayMs = Number(
    process.env.PHOTO_WORKER_RETRY_MS || RETRY_DELAY_DEFAULT_MS,
);
const retryDelayMs =
    Number.isFinite(rawRetryDelayMs) && rawRetryDelayMs > 0
        ? Math.floor(rawRetryDelayMs)
        : RETRY_DELAY_DEFAULT_MS;

let isShuttingDown = false;
let activeConnection = null;
let activeChannel = null;
let stopSoftDeleteSweeper = null;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function closeActiveResources() {
    const channel = activeChannel;
    const connection = activeConnection;
    activeChannel = null;
    activeConnection = null;

    if (channel) {
        try {
            await channel.close();
        } catch (err) {
            void err;
        }
    }

    if (connection) {
        try {
            await connection.close();
        } catch (err) {
            void err;
        }
    }
}

async function runConsumeSession() {
    const { connection, channel, queue } =
        await createPhotoConsumerChannel(prefetch);
    activeConnection = connection;
    activeChannel = channel;

    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, value) => {
            if (settled) {
                return;
            }
            settled = true;
            fn(value);
        };

        connection.on('error', (err) => {
            console.error('[photo-worker] RabbitMQ connection error:', err);
        });

        connection.on('close', () => {
            if (isShuttingDown) {
                done(resolve);
                return;
            }
            done(reject, new Error('RabbitMQ connection closed'));
        });

        channel
            .consume(
                queue,
                async (message) => {
                    if (!message) {
                        return;
                    }

                    let payload;
                    try {
                        payload = JSON.parse(message.content.toString('utf8'));
                    } catch (parseErr) {
                        console.error(
                            '[photo-worker] Invalid queue message JSON, dropping:',
                            parseErr,
                        );
                        channel.ack(message);
                        return;
                    }

                    try {
                        const result = await processPhotoJob(payload);
                        const jobType = String(
                            payload?.jobType || 'photo-upload',
                        );
                        if (jobType !== 'photo-upload') {
                            console.log('[photo-worker] Job completed', {
                                jobType,
                                result,
                            });
                        }
                        channel.ack(message);
                    } catch (err) {
                        console.error(
                            '[photo-worker] Photo processing failed:',
                            err,
                        );
                        // Do not requeue invalid/unprocessable data forever.
                        channel.ack(message);
                    }
                },
                { noAck: false },
            )
            .then(() => {
                console.log(
                    `[photo-worker] Listening queue "${queue}" with prefetch=${prefetch}`,
                );
            })
            .catch((err) => {
                done(reject, err);
            });
    });
}

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    console.log(`[photo-worker] Received ${signal}, shutting down...`);
    if (stopSoftDeleteSweeper) {
        try {
            await stopSoftDeleteSweeper();
        } catch (err) {
            console.error(
                '[photo-worker] Failed to stop soft-delete sweeper:',
                err,
            );
        }
    }
    await closeActiveResources();
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

    while (!isShuttingDown) {
        try {
            await runConsumeSession();
        } catch (err) {
            if (isShuttingDown) {
                break;
            }
            console.error(
                `[photo-worker] RabbitMQ unavailable. Retry in ${retryDelayMs}ms.`,
                err,
            );
            await closeActiveResources();
            await sleep(retryDelayMs);
        }
    }
}

main().catch((err) => {
    console.error('[photo-worker] Fatal worker loop error:', err);
    process.exit(1);
});
