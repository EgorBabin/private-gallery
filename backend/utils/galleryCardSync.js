import { listObjects } from './s3Client.js';
import path from 'path';
import {
    getCardByPath,
    createCard,
    parseCardPath,
    normalizePreviewKey,
    updateCardImageCount,
    updateCardPreviewKey,
} from './cardsStore.js';
import { parseSoftDeleteBase } from './deletionMarker.js';

const PREVIEW_ROOT = 'preview/';
const IMAGE_FILE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;

function isImageKey(key, prefixNoSlash, prefixWithSlash) {
    if (!key) {
        return false;
    }
    if (key === prefixNoSlash || key === prefixWithSlash || key.endsWith('/')) {
        return false;
    }
    if (!IMAGE_FILE_RE.test(key)) {
        return false;
    }

    const baseWithExt = path.posix.basename(String(key));
    const ext = path.posix.extname(baseWithExt);
    const baseNoExt = ext ? baseWithExt.slice(0, -ext.length) : baseWithExt;
    return !parseSoftDeleteBase(baseNoExt);
}

export function normalizePreviewInput(rawPreviewKey) {
    const normalized = normalizePreviewKey(rawPreviewKey);
    if (!normalized) {
        return null;
    }
    return normalized.startsWith(PREVIEW_ROOT)
        ? normalized
        : `${PREVIEW_ROOT}${normalized}`;
}

export async function loadCardStatsFromS3(cardPath) {
    const parsedPath = parseCardPath(cardPath);
    if (!parsedPath) {
        throw new Error('Invalid path format. Use "year/category"');
    }

    const fullPrefix = `${PREVIEW_ROOT}${parsedPath.path}/`;
    const prefixNoSlash = fullPrefix.replace(/\/+$/, '');
    const prefixWithSlash = `${prefixNoSlash}/`;

    let continuationToken = null;
    let imageCount = 0;
    let firstImageKey = null;

    do {
        const page = await listObjects(fullPrefix, 1000, continuationToken);
        const contents = page.Contents || [];

        for (const item of contents) {
            const key = item?.Key;
            if (!isImageKey(key, prefixNoSlash, prefixWithSlash)) {
                continue;
            }
            imageCount += 1;
            if (!firstImageKey) {
                firstImageKey = key;
            }
        }

        continuationToken = page.IsTruncated
            ? page.NextContinuationToken || null
            : null;
    } while (continuationToken);

    return { imageCount, firstImageKey };
}

export async function ensureCardExists(rawPath) {
    const parsedPath = parseCardPath(rawPath);
    if (!parsedPath) {
        throw new Error('Invalid path format. Use "year/category"');
    }

    const existing = await getCardByPath(parsedPath.path);
    if (existing) {
        return existing;
    }

    try {
        return await createCard({
            path: parsedPath.path,
            year: parsedPath.year,
            title: parsedPath.category,
        });
    } catch (err) {
        if (err?.code === '23505') {
            const racedCard = await getCardByPath(parsedPath.path);
            if (racedCard) {
                return racedCard;
            }
        }
        throw err;
    }
}

export async function syncCardByPath(rawPath, preferredPreviewKey = null) {
    const card = await ensureCardExists(rawPath);
    let current = card;

    const stats = await loadCardStatsFromS3(card.path);
    if (stats.imageCount !== current.imageCount) {
        const updatedCountCard = await updateCardImageCount(
            current.id,
            stats.imageCount,
        );
        if (updatedCountCard) {
            current = updatedCountCard;
        }
    }

    const preferred = normalizePreviewInput(preferredPreviewKey);
    const nextPreviewKey =
        current.previewKey || preferred || stats.firstImageKey;

    if (nextPreviewKey && nextPreviewKey !== current.previewKey) {
        const updatedPreviewCard = await updateCardPreviewKey(
            current.id,
            nextPreviewKey,
        );
        if (updatedPreviewCard) {
            current = updatedPreviewCard;
        } else {
            current = { ...current, previewKey: nextPreviewKey };
        }
    }

    return current;
}
