import path from 'path';
import { listAllObjects } from './s3Client.js';
import {
    getPreviewCache,
    setPreviewCache,
    getMediaIndexEntry,
    setMediaIndex,
    clearMediaIndex,
} from './s3Cache.js';

// Единая точка чтения содержимого папок: preview-листинг и индекс
// существующих оригиналов/размеров/видео. Всё кэшируется в Redis и
// сбрасывается через refreshFolderPreviews после любого изменения папки.

export const PREVIEW_ROOT = 'preview/';
export const ORIGINAL_ROOT = 'original_photo/';
export const SCREEN_SIZES = [1280, 1920, 2560];
export const VIDEO_SIZES = [1440, 1080, 720];
const ORIGINAL_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.avif',
    '.gif',
    '.tif',
    '.tiff',
];

const mediaIndexBuilds = new Map();

export function normalizeEtag(value) {
    const etag = String(value || '').trim();
    if (!etag) {
        return null;
    }
    return etag.replace(/^"+|"+$/g, '') || null;
}

export function splitFileName(key) {
    const baseWithExt = path.posix.basename(String(key || ''));
    const ext = path.posix.extname(baseWithExt);
    const base = ext ? baseWithExt.slice(0, -ext.length) : baseWithExt;
    return { base, ext };
}

function isFileKey(key, prefix) {
    if (!key || key.endsWith('/')) {
        return false;
    }
    const prefixNoSlash = prefix.replace(/\/+$/, '');
    return key !== prefix && key !== prefixNoSlash && key.startsWith(prefix);
}

function rankOriginalExtension(ext) {
    const knownIndex = ORIGINAL_EXTENSIONS.indexOf(String(ext).toLowerCase());
    return knownIndex === -1 ? ORIGINAL_EXTENSIONS.length + 1 : knownIndex;
}

async function listFileNames(root, folderPath) {
    const prefix = `${root}${folderPath}/`;
    const objects = await listAllObjects(prefix);
    return objects
        .map((obj) => obj?.Key)
        .filter((key) => isFileKey(key, prefix))
        .map((key) => key.slice(prefix.length));
}

export async function listFolderPreviewsFromS3(folderPath) {
    const prefix = `${PREVIEW_ROOT}${folderPath}/`;
    const objects = await listAllObjects(prefix);
    return objects
        .filter((obj) => isFileKey(obj?.Key, prefix))
        .map((obj) => ({
            key: obj.Key,
            size: Number(obj.Size) || 0,
            lastModified: obj.LastModified
                ? new Date(obj.LastModified).toISOString()
                : null,
            etag: normalizeEtag(obj.ETag),
        }));
}

/** Перечитать папку из S3, обновить кэш и сбросить индекс медиа. */
export async function refreshFolderPreviews(folderPath) {
    const items = await listFolderPreviewsFromS3(folderPath);
    await setPreviewCache(folderPath, items);
    await clearMediaIndex(folderPath);
    return items;
}

/** Листинг preview папки: из кэша, а при промахе из S3. */
export async function getFolderPreviews(folderPath) {
    const cached = await getPreviewCache(folderPath);
    if (Array.isArray(cached) && cached.length > 0) {
        return cached;
    }
    const items = await listFolderPreviewsFromS3(folderPath);
    await setPreviewCache(folderPath, items);
    return items;
}

async function buildMediaIndex(folderPath) {
    const [previews, originals, ...variantNames] = await Promise.all([
        getFolderPreviews(folderPath),
        listFileNames(ORIGINAL_ROOT, folderPath),
        ...SCREEN_SIZES.map((size) =>
            listFileNames(`screen-${size}/`, folderPath),
        ),
        ...VIDEO_SIZES.map((size) =>
            listFileNames(`video_${size}/`, folderPath),
        ),
    ]);

    const originalByBase = new Map();
    for (const name of originals) {
        const { base, ext } = splitFileName(name);
        const current = originalByBase.get(base);
        if (
            !current ||
            rankOriginalExtension(ext) <
                rankOriginalExtension(path.posix.extname(current))
        ) {
            originalByBase.set(base, name);
        }
    }

    const toSet = (names) => new Set(names);
    const screenSets = variantNames.slice(0, SCREEN_SIZES.length).map(toSet);
    const videoSets = variantNames.slice(SCREEN_SIZES.length).map(toSet);

    const entries = {};
    for (const item of previews) {
        const { base } = splitFileName(item.key);
        if (!base) {
            continue;
        }
        if (base.startsWith('video_')) {
            const bare = base.replace(/^video_/, '');
            entries[base] = {
                e: item.etag || null,
                v: VIDEO_SIZES.filter((size, i) =>
                    videoSets[i].has(`${bare}.mp4`),
                ),
            };
            continue;
        }
        const originalName = originalByBase.get(base);
        entries[base] = {
            e: item.etag || null,
            o: originalName
                ? `${ORIGINAL_ROOT}${folderPath}/${originalName}`
                : null,
            s: SCREEN_SIZES.filter((size, i) =>
                screenSets[i].has(`${base}.webp`),
            ),
        };
    }

    await setMediaIndex(folderPath, entries);
    return entries;
}

/**
 * Что существует для медиа `base` в папке:
 * фото { e: etag preview, o: ключ оригинала|null, s: [размеры screen-*] },
 * видео { e, v: [размеры video_*] }, либо null.
 */
export async function getMediaEntry(folderPath, base) {
    const hit = await getMediaIndexEntry(folderPath, base);
    if (hit.built) {
        return hit.entry;
    }

    // один построитель индекса на папку, даже при параллельных запросах
    let build = mediaIndexBuilds.get(folderPath);
    if (!build) {
        build = buildMediaIndex(folderPath).finally(() => {
            mediaIndexBuilds.delete(folderPath);
        });
        mediaIndexBuilds.set(folderPath, build);
    }
    const entries = await build;
    return entries[base] || null;
}
