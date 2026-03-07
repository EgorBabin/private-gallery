import {
    copyObjectInS3,
    deleteFromS3,
    headObjectMeta,
} from '../utils/s3Client.js';
import { syncCardByPath } from '../utils/galleryCardSync.js';

const SOFT_DELETE_ACTIONS = new Set(['delete', 'restore']);

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

function normalizeMove(move, index) {
    const sourceKey = sanitizeKey(move?.sourceKey);
    const targetKey = sanitizeKey(move?.targetKey);
    const expectedHash = normalizeHash(move?.hash);

    if (!sourceKey) {
        throw new Error(
            `Invalid soft-delete payload: moves[${index}].sourceKey`,
        );
    }
    if (!targetKey) {
        throw new Error(
            `Invalid soft-delete payload: moves[${index}].targetKey`,
        );
    }
    if (!expectedHash) {
        throw new Error(`Invalid soft-delete payload: moves[${index}].hash`);
    }

    return {
        sourceKey,
        targetKey,
        expectedHash,
        size: Number(move?.size) || 0,
    };
}

function normalizeJob(rawPayload) {
    const payload =
        rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const action = String(payload.action || '')
        .trim()
        .toLowerCase();
    const folderPath = String(payload.folderPath || '').trim();
    const moves = Array.isArray(payload.moves) ? payload.moves : [];

    if (!SOFT_DELETE_ACTIONS.has(action)) {
        throw new Error('Invalid soft-delete payload: action is required');
    }
    if (!folderPath) {
        throw new Error('Invalid soft-delete payload: folderPath is required');
    }
    if (moves.length === 0) {
        throw new Error('Invalid soft-delete payload: moves must be non-empty');
    }

    return {
        action,
        folderPath,
        moves: moves.map((move, index) => normalizeMove(move, index)),
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

async function applyMove(move) {
    if (move.sourceKey === move.targetKey) {
        const meta = await readMetaSafe(move.sourceKey);
        if (!matchesHash(meta, move.expectedHash)) {
            throw new Error(
                `Source hash mismatch for key ${move.sourceKey} when source and target are equal`,
            );
        }
        return;
    }

    const targetMetaBefore = await readMetaSafe(move.targetKey);
    if (matchesHash(targetMetaBefore, move.expectedHash)) {
        const sourceMeta = await readMetaSafe(move.sourceKey);
        if (matchesHash(sourceMeta, move.expectedHash)) {
            await deleteFromS3(move.sourceKey);
        }
        return;
    }

    const sourceMeta = await readMetaSafe(move.sourceKey);
    if (!matchesHash(sourceMeta, move.expectedHash)) {
        throw new Error(
            `Source object is missing or hash mismatch: ${move.sourceKey}`,
        );
    }

    await copyObjectInS3(move.sourceKey, move.targetKey);
    const targetMetaAfter = await headObjectMeta(move.targetKey);
    if (!matchesHash(targetMetaAfter, move.expectedHash)) {
        throw new Error(
            `Hash mismatch after rename: ${move.sourceKey} -> ${move.targetKey}`,
        );
    }

    await deleteFromS3(move.sourceKey);
}

export async function processGallerySoftDeleteJob(rawPayload) {
    const job = normalizeJob(rawPayload);
    let processed = 0;

    for (const move of job.moves) {
        await applyMove(move);
        processed += 1;
    }

    try {
        await syncCardByPath(job.folderPath);
    } catch (syncErr) {
        console.error(
            'Failed to sync card after soft-delete action',
            job.folderPath,
            syncErr,
        );
    }

    return {
        action: job.action,
        folderPath: job.folderPath,
        totalMoves: processed,
    };
}
