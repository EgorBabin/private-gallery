import path from 'path';
import {
    copyObjectInS3,
    deleteFromS3,
    headObjectMeta,
    uploadToS3,
} from '../utils/s3Client.js';
import { syncCardByPath } from '../utils/galleryCardSync.js';

const COPY_CONCURRENCY_DEFAULT = 4;
const VERIFY_CONCURRENCY_DEFAULT = 6;
const ATTEMPTS_DEFAULT = 4;
const RETRY_DELAY_DEFAULT_MS = 1200;

const rawCopyConcurrency = Number(
    process.env.GALLERY_REORDER_COPY_CONCURRENCY || COPY_CONCURRENCY_DEFAULT,
);
const COPY_CONCURRENCY =
    Number.isInteger(rawCopyConcurrency) && rawCopyConcurrency > 0
        ? rawCopyConcurrency
        : COPY_CONCURRENCY_DEFAULT;

const rawVerifyConcurrency = Number(
    process.env.GALLERY_REORDER_VERIFY_CONCURRENCY ||
        VERIFY_CONCURRENCY_DEFAULT,
);
const VERIFY_CONCURRENCY =
    Number.isInteger(rawVerifyConcurrency) && rawVerifyConcurrency > 0
        ? rawVerifyConcurrency
        : VERIFY_CONCURRENCY_DEFAULT;

const rawMaxAttempts = Number(
    process.env.GALLERY_REORDER_MAX_ATTEMPTS || ATTEMPTS_DEFAULT,
);
const MAX_ATTEMPTS =
    Number.isInteger(rawMaxAttempts) && rawMaxAttempts > 0
        ? rawMaxAttempts
        : ATTEMPTS_DEFAULT;

const rawRetryDelayMs = Number(
    process.env.GALLERY_REORDER_RETRY_MS || RETRY_DELAY_DEFAULT_MS,
);
const RETRY_DELAY_MS =
    Number.isFinite(rawRetryDelayMs) && rawRetryDelayMs > 0
        ? Math.floor(rawRetryDelayMs)
        : RETRY_DELAY_DEFAULT_MS;

function normalizeHash(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/^"+|"+$/g, '');
    return normalized || null;
}

function sanitizeKey(value) {
    return String(value || '')
        .trim()
        .replace(/^\/+/, '');
}

function matchesHash(meta, expectedHash) {
    if (!meta || !meta.etag || !expectedHash) {
        return false;
    }
    return normalizeHash(meta.etag) === normalizeHash(expectedHash);
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function mapWithConcurrency(items, limit, mapper) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    const workerCount = Math.min(limit, items.length);
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await mapper(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

async function writeStatus(statusKey, payload) {
    await uploadToS3(
        Buffer.from(JSON.stringify(payload)),
        statusKey,
        'application/json',
    );
}

async function safeWriteStatus(statusKey, payload) {
    try {
        await writeStatus(statusKey, payload);
    } catch (err) {
        console.error('Failed to write reorder status', statusKey, err);
    }
}

function tempKeyForMove(folderPath, jobId, index, keyHint) {
    const ext = path.posix.extname(keyHint || '').toLowerCase();
    const safeExt = ext && ext.length <= 12 ? ext : '.bin';
    return `processing/reorder/tmp/${folderPath}/${jobId}/${index}${safeExt}`;
}

function normalizeMove(move, index, folderPath, jobId) {
    const sourceKey = sanitizeKey(move?.sourceKey);
    const targetKey = sanitizeKey(move?.targetKey);
    const expectedHash = normalizeHash(move?.hash);
    const size = Number(move?.size) || 0;

    if (!sourceKey) {
        throw new Error(`Invalid reorder payload: moves[${index}].sourceKey`);
    }
    if (!targetKey) {
        throw new Error(`Invalid reorder payload: moves[${index}].targetKey`);
    }
    if (!expectedHash) {
        throw new Error(`Invalid reorder payload: moves[${index}].hash`);
    }

    return {
        id: `${index}`,
        sourceKey,
        targetKey,
        expectedHash,
        size,
        tempKey: tempKeyForMove(folderPath, jobId, index, targetKey),
    };
}

function normalizeJob(rawPayload) {
    const payload =
        rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const folderPath = String(payload.folderPath || '').trim();
    const jobId = String(payload.jobId || '').trim();
    const statusKey = sanitizeKey(payload.statusKey);
    const rawMoves = Array.isArray(payload.moves) ? payload.moves : [];

    if (!folderPath) {
        throw new Error('Invalid reorder payload: folderPath is required');
    }
    if (!jobId) {
        throw new Error('Invalid reorder payload: jobId is required');
    }
    if (!statusKey) {
        throw new Error('Invalid reorder payload: statusKey is required');
    }
    if (rawMoves.length === 0) {
        throw new Error('Invalid reorder payload: moves must be non-empty');
    }

    const moves = rawMoves.map((move, index) =>
        normalizeMove(move, index, folderPath, jobId),
    );

    return {
        folderPath,
        jobId,
        statusKey,
        moves,
    };
}

async function readMetaSafe(key) {
    try {
        return await headObjectMeta(key, { silentNotFound: true });
    } catch (err) {
        if (err?.code === 'NoSuchKey') {
            return null;
        }
        throw err;
    }
}

async function collectPendingMoves(moves) {
    const checks = await mapWithConcurrency(
        moves,
        VERIFY_CONCURRENCY,
        async (move) => {
            const meta = await readMetaSafe(move.targetKey);
            return {
                move,
                ready: matchesHash(meta, move.expectedHash),
            };
        },
    );

    const ready = checks.filter((entry) => entry.ready).length;
    const pending = checks
        .filter((entry) => !entry.ready)
        .map((entry) => entry.move);

    return { ready, pending };
}

async function resolveSourceKey(move) {
    const candidates = [move.sourceKey, move.tempKey, move.targetKey].filter(
        Boolean,
    );

    const seen = new Set();
    for (const key of candidates) {
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const meta = await readMetaSafe(key);
        if (matchesHash(meta, move.expectedHash)) {
            return key;
        }
    }
    return null;
}

async function stageTemps(pendingMoves) {
    await mapWithConcurrency(pendingMoves, COPY_CONCURRENCY, async (move) => {
        const sourceKey = await resolveSourceKey(move);
        if (!sourceKey) {
            throw new Error(
                `Source object not found for move ${move.id}: ${move.sourceKey} -> ${move.targetKey}`,
            );
        }

        if (sourceKey !== move.tempKey) {
            await copyObjectInS3(sourceKey, move.tempKey);
        }

        const tempMeta = await headObjectMeta(move.tempKey);
        if (!matchesHash(tempMeta, move.expectedHash)) {
            throw new Error(
                `Hash mismatch after temp stage for move ${move.id}: ${move.tempKey}`,
            );
        }
    });
}

async function writeTargets(pendingMoves) {
    await mapWithConcurrency(pendingMoves, COPY_CONCURRENCY, async (move) => {
        await copyObjectInS3(move.tempKey, move.targetKey);
        const targetMeta = await headObjectMeta(move.targetKey);
        if (!matchesHash(targetMeta, move.expectedHash)) {
            throw new Error(
                `Hash mismatch after write stage for move ${move.id}: ${move.targetKey}`,
            );
        }
    });
}

async function verifyTargets(moves) {
    const validation = await mapWithConcurrency(
        moves,
        VERIFY_CONCURRENCY,
        async (move) => {
            const meta = await readMetaSafe(move.targetKey);
            return matchesHash(meta, move.expectedHash);
        },
    );
    return validation.every(Boolean);
}

async function cleanupAfterSuccess(moves) {
    const targetKeys = new Set(moves.map((move) => move.targetKey));
    const cleanupKeys = new Set();

    for (const move of moves) {
        cleanupKeys.add(move.tempKey);
        if (
            move.sourceKey !== move.targetKey &&
            !targetKeys.has(move.sourceKey)
        ) {
            cleanupKeys.add(move.sourceKey);
        }
    }

    const keys = Array.from(cleanupKeys.values());
    await mapWithConcurrency(keys, COPY_CONCURRENCY, async (key) => {
        try {
            await deleteFromS3(key);
        } catch (err) {
            console.error('Failed to cleanup reorder key', key, err);
        }
    });
}

export async function processGalleryReorderJob(rawPayload) {
    const job = normalizeJob(rawPayload);
    const startedAt = new Date().toISOString();
    let lastError = null;

    await safeWriteStatus(job.statusKey, {
        status: 'processing',
        stage: 'starting',
        startedAt,
        attempt: 0,
        maxAttempts: MAX_ATTEMPTS,
        total: job.moves.length,
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            const { ready, pending } = await collectPendingMoves(job.moves);

            await safeWriteStatus(job.statusKey, {
                status: 'processing',
                stage: 'staging-temp',
                startedAt,
                attempt,
                maxAttempts: MAX_ATTEMPTS,
                total: job.moves.length,
                ready,
                pending: pending.length,
            });

            if (pending.length > 0) {
                await stageTemps(pending);

                await safeWriteStatus(job.statusKey, {
                    status: 'processing',
                    stage: 'writing-targets',
                    startedAt,
                    attempt,
                    maxAttempts: MAX_ATTEMPTS,
                    total: job.moves.length,
                    ready,
                    pending: pending.length,
                });

                await writeTargets(pending);
            }

            const allValid = await verifyTargets(job.moves);
            if (!allValid) {
                throw new Error('Target hash verification failed');
            }

            await cleanupAfterSuccess(job.moves);

            try {
                await syncCardByPath(job.folderPath);
            } catch (syncErr) {
                console.error(
                    'Failed to sync card after reorder',
                    job.folderPath,
                    syncErr,
                );
            }

            await safeWriteStatus(job.statusKey, {
                status: 'done',
                stage: 'completed',
                startedAt,
                finishedAt: new Date().toISOString(),
                attempt,
                total: job.moves.length,
            });

            return {
                folderPath: job.folderPath,
                total: job.moves.length,
                attempts: attempt,
            };
        } catch (err) {
            lastError = err;
            console.error('Reorder attempt failed', {
                jobId: job.jobId,
                folderPath: job.folderPath,
                attempt,
                maxAttempts: MAX_ATTEMPTS,
                error: String(err),
            });

            if (attempt < MAX_ATTEMPTS) {
                await safeWriteStatus(job.statusKey, {
                    status: 'processing',
                    stage: 'retrying',
                    startedAt,
                    attempt,
                    maxAttempts: MAX_ATTEMPTS,
                    retryInMs: RETRY_DELAY_MS,
                    error: String(err),
                });
                await sleep(RETRY_DELAY_MS);
            }
        }
    }

    const message = String(lastError || 'Unknown reorder error');
    await safeWriteStatus(job.statusKey, {
        status: 'error',
        stage: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        attempt: MAX_ATTEMPTS,
        maxAttempts: MAX_ATTEMPTS,
        error: message,
    });

    throw lastError || new Error('Gallery reorder failed');
}
