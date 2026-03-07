import path from 'path';
import { deleteFromS3, listObjects } from '../utils/s3Client.js';
import { syncCardByPath } from '../utils/galleryCardSync.js';
import { parseSoftDeleteBase } from '../utils/deletionMarker.js';

const PREVIEW_ROOT = 'preview/';
const ORIGINAL_ROOT = 'original_photo/';
const SCREEN_DIRS = ['screen-1280', 'screen-1920', 'screen-2560'];
const VIDEO_DIRS = ['video_1440', 'video_1080', 'video_720'];
const CARD_PATH_RE = /^\d{1,4}\/[A-Za-z]+$/;
const MEDIA_FILE_RE = /\.(jpe?g|png|webp|avif|gif|mp4|tiff?)$/i;

const SWEEP_INTERVAL_DEFAULT_MS = 1000 * 60 * 60;
const rawSweepIntervalMs = Number(
    process.env.GALLERY_SOFT_DELETE_SWEEP_INTERVAL_MS ||
        SWEEP_INTERVAL_DEFAULT_MS,
);
const SWEEP_INTERVAL_MS =
    Number.isFinite(rawSweepIntervalMs) && rawSweepIntervalMs > 0
        ? Math.floor(rawSweepIntervalMs)
        : SWEEP_INTERVAL_DEFAULT_MS;

const DELETE_CONCURRENCY_DEFAULT = 8;
const rawDeleteConcurrency = Number(
    process.env.GALLERY_SOFT_DELETE_DELETE_CONCURRENCY ||
        DELETE_CONCURRENCY_DEFAULT,
);
const DELETE_CONCURRENCY =
    Number.isInteger(rawDeleteConcurrency) && rawDeleteConcurrency > 0
        ? rawDeleteConcurrency
        : DELETE_CONCURRENCY_DEFAULT;

function sanitizeKey(value) {
    return String(value || '')
        .trim()
        .replace(/^\/+/, '');
}

function stripExt(name) {
    const ext = path.posix.extname(name);
    return ext ? name.slice(0, -ext.length) : name;
}

function isFileObject(obj, prefix) {
    const key = String(obj?.Key || '');
    if (!key || key.endsWith('/')) {
        return false;
    }

    const cleanPrefix = String(prefix || '').replace(/\/+$/, '');
    if (key === cleanPrefix || key === `${cleanPrefix}/`) {
        return false;
    }

    return MEDIA_FILE_RE.test(key);
}

function extractFolderPathFromPreviewKey(key) {
    const cleanKey = sanitizeKey(key);
    if (!cleanKey.startsWith(PREVIEW_ROOT)) {
        return null;
    }

    const relative = cleanKey.slice(PREVIEW_ROOT.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length < 3) {
        return null;
    }

    const folderPath = `${parts[0] || ''}/${parts[1] || ''}`;
    if (!CARD_PATH_RE.test(folderPath)) {
        return null;
    }
    return folderPath;
}

function parseDeleteBaseFromPreviewKey(key, folderPath) {
    const cleanKey = sanitizeKey(key);
    const prefix = `${PREVIEW_ROOT}${folderPath}/`;
    if (!cleanKey.startsWith(prefix)) {
        return null;
    }

    const relative = cleanKey.slice(prefix.length);
    if (!relative || relative.includes('/')) {
        return null;
    }

    const baseNoExt = stripExt(relative);
    const meta = parseSoftDeleteBase(baseNoExt);
    if (!meta) {
        return null;
    }

    return {
        deleteBase: baseNoExt,
        deleteAt: meta.deleteAt,
    };
}

async function listAllObjectsForPrefix(prefix) {
    const output = [];
    let continuationToken = null;

    do {
        const page = await listObjects(prefix, 1000, continuationToken);
        output.push(...(page.Contents || []));
        continuationToken = page.IsTruncated
            ? page.NextContinuationToken || null
            : null;
    } while (continuationToken);

    return output;
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

function dueDeleteGroupsFromPreviewObjects(previewObjects, now) {
    const dueByFolder = new Map();

    for (const obj of previewObjects) {
        const key = sanitizeKey(obj?.Key);
        if (!key || key.endsWith('/')) {
            continue;
        }

        const folderPath = extractFolderPathFromPreviewKey(key);
        if (!folderPath) {
            continue;
        }

        const parsed = parseDeleteBaseFromPreviewKey(key, folderPath);
        if (!parsed) {
            continue;
        }

        if (parsed.deleteAt.getTime() > now.getTime()) {
            continue;
        }

        const set = dueByFolder.get(folderPath) || new Set();
        set.add(parsed.deleteBase);
        dueByFolder.set(folderPath, set);
    }

    return dueByFolder;
}

async function collectKeysToDeleteForFolder(folderPath, dueBaseSet) {
    const prefixes = [
        `${PREVIEW_ROOT}${folderPath}/`,
        ...SCREEN_DIRS.map((dir) => `${dir}/${folderPath}/`),
        `${ORIGINAL_ROOT}${folderPath}/`,
        ...VIDEO_DIRS.map((dir) => `${dir}/${folderPath}/`),
    ];
    const keys = new Set();

    const listed = await Promise.all(
        prefixes.map(async (prefix) => {
            const objects = await listAllObjectsForPrefix(prefix);
            return objects.filter((obj) => isFileObject(obj, prefix));
        }),
    );

    for (const objectList of listed) {
        for (const obj of objectList) {
            const cleanKey = sanitizeKey(obj?.Key);
            if (!cleanKey) {
                continue;
            }

            const baseWithExt = path.posix.basename(cleanKey);
            const baseNoExt = stripExt(baseWithExt);
            if (dueBaseSet.has(baseNoExt)) {
                keys.add(cleanKey);
            }
        }
    }

    return Array.from(keys.values());
}

async function deleteKeys(keys) {
    await mapWithConcurrency(keys, DELETE_CONCURRENCY, async (key) => {
        try {
            await deleteFromS3(key);
        } catch (err) {
            console.error('Failed to delete expired soft-delete key', key, err);
        }
    });
}

export async function sweepExpiredSoftDeletedMedia(now = new Date()) {
    const previewObjects = await listAllObjectsForPrefix(PREVIEW_ROOT);
    const dueByFolder = dueDeleteGroupsFromPreviewObjects(previewObjects, now);

    let dueGroups = 0;
    let deletedKeys = 0;
    let syncedFolders = 0;

    for (const [folderPath, dueBaseSet] of dueByFolder.entries()) {
        dueGroups += dueBaseSet.size;
        const keys = await collectKeysToDeleteForFolder(folderPath, dueBaseSet);
        if (keys.length === 0) {
            continue;
        }

        await deleteKeys(keys);
        deletedKeys += keys.length;

        try {
            await syncCardByPath(folderPath);
            syncedFolders += 1;
        } catch (syncErr) {
            console.error(
                'Failed to sync card after expired media cleanup',
                folderPath,
                syncErr,
            );
        }
    }

    return {
        scannedPreviewObjects: previewObjects.length,
        foldersWithDueGroups: dueByFolder.size,
        dueGroups,
        deletedKeys,
        syncedFolders,
    };
}

export function startSoftDeleteSweeper() {
    let timer = null;
    let activeRun = null;
    let stopped = false;

    const runOnce = async () => {
        if (stopped || activeRun) {
            return activeRun;
        }

        activeRun = (async () => {
            try {
                const result = await sweepExpiredSoftDeletedMedia(new Date());
                console.log('[soft-delete-sweeper] scan result', result);
            } catch (err) {
                console.error(
                    '[soft-delete-sweeper] cleanup iteration failed',
                    err,
                );
            } finally {
                activeRun = null;
            }
        })();

        return activeRun;
    };

    timer = setInterval(() => {
        void runOnce();
    }, SWEEP_INTERVAL_MS);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    void runOnce();

    return async function stopSweeper() {
        stopped = true;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (activeRun) {
            await activeRun;
        }
    };
}
