import express from 'express';
import { listObjects, getSignedUrlForKey } from '../utils/s3Client.js';
import { parseNumericIndexFromBase } from '../utils/deletionMarker.js';
import { logAction } from '../utils/logger.js';
import {
    listCards,
    updateCardImageCount,
    updateCardPreviewKey,
} from '../utils/cardsStore.js';
import path from 'path';
import { parseSoftDeleteBase } from '../utils/deletionMarker.js';

const router = express.Router();

const PREVIEW_ROOT = 'preview/';
const ORIGINAL_ROOT = 'original_photo/';
const SCREEN_DIRS = ['screen-1280', 'screen-1920', 'screen-2560'];
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
const CARD_PREFIX_RE = /^\d{1,4}\/[A-Za-z]+$/;
const RELATIVE_MEDIA_KEY_RE =
    /^\d{1,4}\/[A-Za-z]+\/(?:video_)?[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;
const SESSION_MAX_AGE_MS = 1000 * 60 * 30;
const CARDS_S3_CONCURRENCY = 6;
const IS_DEBUG_LOGS = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

async function mapWithConcurrency(items, limit, mapper) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= items.length) {
                return;
            }

            results[currentIndex] = await mapper(
                items[currentIndex],
                currentIndex,
            );
        }
    }

    const workersCount = Math.min(limit, items.length);
    const workers = Array.from({ length: workersCount }, () => worker());
    await Promise.all(workers);
    return results;
}

function normalizeCardPathForS3(cardPath) {
    return String(cardPath ?? '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/\.\./g, '');
}

function normalizePreviewKeyForS3(previewKey) {
    const cleaned = String(previewKey ?? '')
        .trim()
        .replace(/^\/+/, '');
    if (!cleaned) {
        return null;
    }
    return cleaned.startsWith(PREVIEW_ROOT)
        ? cleaned
        : `${PREVIEW_ROOT}${cleaned}`;
}

function splitPath(cardPath) {
    const clean = normalizeCardPathForS3(cardPath);
    const parts = clean.split('/').filter(Boolean);
    return {
        year: parts[0] || '',
        category: parts.slice(1).join('/'),
    };
}

async function findFirstSignedUrl(keys, expiresInSec) {
    for (const key of keys) {
        try {
            const url = await getSignedUrlForKey(key, expiresInSec, {
                silentNotFound: true,
            });
            return { key, url };
        } catch (err) {
            void err;
        }
    }
    return null;
}

function rankOriginalExtension(ext) {
    const normalized = String(ext || '').toLowerCase();
    const knownIndex = ORIGINAL_EXTENSIONS.indexOf(normalized);
    return knownIndex === -1 ? ORIGINAL_EXTENSIONS.length + 1 : knownIndex;
}

async function resolveOriginalCandidates(baseNoExt) {
    const fallbackCandidates = ORIGINAL_EXTENSIONS.map(
        (candidateExt) => `${ORIGINAL_ROOT}${baseNoExt}${candidateExt}`,
    );

    const prefix = `${ORIGINAL_ROOT}${baseNoExt}.`;
    const discoveredKeys = [];
    let continuationToken = null;

    try {
        do {
            const page = await listObjects(prefix, 1000, continuationToken);
            const contents = page.Contents || [];
            for (const item of contents) {
                const key = item?.Key;
                if (!key || key.endsWith('/')) {
                    continue;
                }
                if (!key.startsWith(prefix)) {
                    continue;
                }
                discoveredKeys.push(key);
            }
            continuationToken = page.IsTruncated
                ? page.NextContinuationToken || null
                : null;
        } while (continuationToken);
    } catch {
        return fallbackCandidates;
    }

    if (discoveredKeys.length === 0) {
        return fallbackCandidates;
    }

    discoveredKeys.sort((a, b) => {
        const extA = path.posix.extname(a);
        const extB = path.posix.extname(b);
        const rankA = rankOriginalExtension(extA);
        const rankB = rankOriginalExtension(extB);
        if (rankA !== rankB) {
            return rankA - rankB;
        }
        return a.localeCompare(b);
    });

    return discoveredKeys;
}

function isImageKey(key, prefixNoSlash, prefixWithSlash) {
    if (!key) {
        return false;
    }
    if (key === prefixNoSlash || key === prefixWithSlash) {
        return false;
    }
    if (key.endsWith('/')) {
        return false;
    }
    if (!/\.(jpe?g|png|webp|avif|gif)$/i.test(key)) {
        return false;
    }

    const baseWithExt = path.posix.basename(String(key));
    const ext = path.posix.extname(baseWithExt);
    const baseNoExt = ext ? baseWithExt.slice(0, -ext.length) : baseWithExt;
    return !parseSoftDeleteBase(baseNoExt);
}

async function loadCardStatsFromS3(cardPath) {
    const safePath = normalizeCardPathForS3(cardPath);
    if (!safePath) {
        return { imageCount: 0, firstImageKey: null };
    }

    const fullPrefix = `${PREVIEW_ROOT}${safePath}/`;
    const prefixNoSlash = fullPrefix.replace(/\/+$/, '');
    const prefixWithSlash = `${prefixNoSlash}/`;

    let continuationToken;
    let imageCount = 0;
    let firstImageKey = null;

    do {
        const data = await listObjects(fullPrefix, 1000, continuationToken);
        const contents = data.Contents || [];

        for (const obj of contents) {
            const key = obj?.Key;
            if (!isImageKey(key, prefixNoSlash, prefixWithSlash)) {
                continue;
            }
            imageCount += 1;
            if (!firstImageKey) {
                firstImageKey = key;
            }
        }

        continuationToken = data.IsTruncated
            ? data.NextContinuationToken || null
            : null;
    } while (continuationToken);

    return { imageCount, firstImageKey };
}

// GET /api/gallery/cards
router.get('/cards', async (req, res) => {
    try {
        const storedCards = await listCards();

        const cards = await mapWithConcurrency(
            storedCards,
            CARDS_S3_CONCURRENCY,
            async (card) => {
                const { year: pathYear, category } = splitPath(card.path);

                let imageCount = card.imageCount;
                let firstImageKey = null;

                try {
                    const stats = await loadCardStatsFromS3(card.path);
                    imageCount = stats.imageCount;
                    firstImageKey = stats.firstImageKey;

                    if (imageCount !== card.imageCount) {
                        await updateCardImageCount(card.id, imageCount);
                    }
                } catch (statsErr) {
                    console.error(
                        'Failed to read card stats from S3',
                        card.path,
                        statsErr,
                    );
                }

                let previewKey = normalizePreviewKeyForS3(card.previewKey);
                if (!previewKey && firstImageKey) {
                    previewKey = firstImageKey;
                    try {
                        await updateCardPreviewKey(card.id, firstImageKey);
                    } catch (previewErr) {
                        console.error(
                            'Failed to persist preview key for card',
                            card.path,
                            previewErr,
                        );
                    }
                }

                let thumbnailUrl = null;
                if (previewKey) {
                    try {
                        thumbnailUrl = await getSignedUrlForKey(
                            previewKey,
                            60 * 5,
                            { skipHead: true },
                        );
                    } catch (urlErr) {
                        console.error(
                            'Failed to sign preview key',
                            previewKey,
                            urlErr,
                        );
                    }
                }

                const resultYear = Number.isInteger(card.year)
                    ? card.year
                    : Number(pathYear) || 0;

                return {
                    id: card.id,
                    path: card.path,
                    year: resultYear,
                    category,
                    title: card.title,
                    prefix: `${card.path}/`,
                    thumbnailUrl,
                    imageCount,
                    sortOrder: card.sortOrder,
                    previewKey,
                };
            },
        );

        if (req.session?.user) {
            req.session.cookie.maxAge = SESSION_MAX_AGE_MS;
        }

        res.json({ cards });
        logAction(req, 'Get cards', '#gallery.js #cards');
    } catch (err) {
        console.error('cards error', err);
        res.status(500).json({ error: err.message });
        logAction(
            req,
            'Cards error',
            `${err}
            #gallery.js #cards #error`,
        );
    }
});

// GET /api/gallery/previews?prefix=year/category/&limit=100&continuationToken=...
router.get('/previews', async (req, res) => {
    try {
        const prefixParam = req.query.prefix;
        if (!prefixParam) {
            return res.status(400).json({ error: 'prefix query required' });
        }

        const normalizedPrefix = normalizeCardPathForS3(prefixParam).replace(
            /\/+$/,
            '',
        );
        if (!CARD_PREFIX_RE.test(normalizedPrefix)) {
            return res.status(400).json({
                error: 'Некорректный prefix. Используйте формат "year/category"',
            });
        }

        const parsedLimit = Number.parseInt(req.query.limit || '200', 10);
        const limit =
            Number.isInteger(parsedLimit) && parsedLimit > 0
                ? Math.min(parsedLimit, 1000)
                : 200;
        const includeDeletedRequested = String(
            req.query.includeDeleted || '',
        ).trim();
        const includeDeletedByRole =
            String(req.session?.user?.role || '')
                .trim()
                .toLowerCase() === 'admin';
        const includeDeleted =
            includeDeletedByRole &&
            ['1', 'true', 'yes'].includes(
                includeDeletedRequested.toLowerCase(),
            );
        const continuationToken = req.query.continuationToken;

        const fullPrefix = `${PREVIEW_ROOT}${normalizedPrefix}/`;
        const data = await listObjects(fullPrefix, limit, continuationToken);
        const contents = data.Contents || [];

        // Нормализуем префикс — с и без завершающего слэша
        const prefixNoSlash = fullPrefix.replace(/\/+$/, '');
        const prefixWithSlash = prefixNoSlash + '/';

        // Отфильтровываем объекты-папки:
        const fileContents = contents.filter((obj) => {
            if (!obj || !obj.Key) {
                return false;
            }
            if (obj.Key === prefixNoSlash || obj.Key === prefixWithSlash) {
                if (IS_DEBUG_LOGS) {
                    console.debug(
                        'Skipping folder placeholder object from S3:',
                        obj.Key,
                    );
                }
                return false;
            }
            if (obj.Key.endsWith('/')) {
                if (IS_DEBUG_LOGS) {
                    console.debug(
                        'Skipping directory-like key from S3:',
                        obj.Key,
                    );
                }
                return false;
            }
            return true;
        });

        // преобразуем в объекты с индексом и url (вызываем signed url только для реальных файлов)
        const mappedItems = await Promise.all(
            fileContents.map(async (obj) => {
                const baseWithExt = path.posix.basename(obj.Key); // e.g. "video_12345.webp" or "12345.webp"
                const ext = path.posix.extname(baseWithExt);
                const rawBase = ext
                    ? baseWithExt.slice(0, -ext.length)
                    : baseWithExt;
                const softDeleteMeta = parseSoftDeleteBase(rawBase);

                if (softDeleteMeta && !includeDeleted) {
                    return null;
                }

                const displayBase =
                    softDeleteMeta?.originalBase || String(rawBase || '');
                const idx = parseNumericIndexFromBase(displayBase) ?? 0;
                const isVideo = displayBase.startsWith('video_');
                const name = isVideo
                    ? displayBase.replace(/^video_/, '')
                    : displayBase;

                const url = await getSignedUrlForKey(obj.Key, 60 * 5, {
                    skipHead: true,
                });

                const deleteDueAt = softDeleteMeta?.deleteAt || null;
                const deleteDaysLeft = deleteDueAt
                    ? Math.max(
                          0,
                          Math.ceil(
                              (deleteDueAt.getTime() - Date.now()) /
                                  (24 * 60 * 60 * 1000),
                          ),
                      )
                    : null;

                return {
                    key: obj.Key,
                    url,
                    index: idx,
                    size: obj.Size,
                    lastModified: obj.LastModified,
                    isVideo, // video preview
                    name,
                    isPendingDeletion: Boolean(softDeleteMeta),
                    deleteDueAt: deleteDueAt ? deleteDueAt.toISOString() : null,
                    deleteDaysLeft,
                };
            }),
        );
        const items = mappedItems.filter(Boolean);

        items.sort((a, b) => a.index - b.index);

        res.json({
            items,
            isTruncated: !!data.IsTruncated,
            nextContinuationToken: data.NextContinuationToken || null,
        });
        logAction(req, 'Get previews', '#gallery.js #previews');
    } catch (err) {
        console.error('previews error', err);
        res.status(500).json({ error: err.message });
        logAction(
            req,
            'Previews error',
            `${err}
            #gallery.js #previews #error`,
        );
    }
});

// GET /api/gallery/original?key=year/category/1.jpg  or key=original/year/..
router.get('/original', async (req, res) => {
    try {
        let key = req.query.key;
        if (!key) {
            return res.status(400).json({ error: 'key required' });
        }

        key = key.replace(/^\/+/, '').replace(/\.\./g, '');
        let relative = key;
        if (key.startsWith(ORIGINAL_ROOT)) {
            relative = key.slice(ORIGINAL_ROOT.length);
        } else if (key.startsWith(PREVIEW_ROOT)) {
            relative = key.slice(PREVIEW_ROOT.length);
        } else {
            relative = key;
        }

        relative = relative.replace(/^\/+/, '');
        if (!RELATIVE_MEDIA_KEY_RE.test(relative)) {
            return res.status(400).json({
                error: 'Некорректный key. Используйте формат "year/category/file.ext"',
            });
        }

        const ext = path.posix.extname(relative);
        const baseNoExt = ext ? relative.slice(0, -ext.length) : relative;

        const baseNameOnly = path.posix.basename(baseNoExt); // e.g. "video_12345" or "12345"
        const isVideo = baseNameOnly.startsWith('video_');

        const previewKey = `${PREVIEW_ROOT}${baseNoExt}.webp`;
        const screenKeys = SCREEN_DIRS.map((dir) => `${dir}/${baseNoExt}.webp`);

        if (isVideo) {
            // preview оставляем с video_ в названии,
            // а ключи к .mp4 строим без префикса video_
            const dirName = path.posix.dirname(baseNoExt); // e.g. "2024/event" или "."
            const bareBase = baseNameOnly.replace(/^video_/, ''); // "12345"
            const videoBase =
                dirName === '.' || dirName === ''
                    ? bareBase
                    : `${dirName}/${bareBase}`;

            const VIDEO_DIRS = ['video_1440', 'video_1080', 'video_720'];
            const videoKeys = VIDEO_DIRS.map((d) => `${d}/${videoBase}.mp4`);

            const previewUrlPromise = getSignedUrlForKey(
                previewKey,
                60 * 5,
            ).catch((e) => {
                console.error('preview signed url failed', previewKey, e);
                return null;
            });

            const videoUrlPromises = videoKeys.map((k) =>
                getSignedUrlForKey(k, 60 * 30).catch((e) => {
                    console.error('getSignedUrlForKey failed for', k, e);
                    return null;
                }),
            );

            const previewUrl = await previewUrlPromise;
            const videoUrls = await Promise.all(videoUrlPromises);

            const videos = {
                1440: { key: videoKeys[0], url: videoUrls[0] },
                1080: { key: videoKeys[1], url: videoUrls[1] },
                720: { key: videoKeys[2], url: videoUrls[2] },
            };

            logAction(req, 'Get original', '#gallery.js #original #video');
            return res.json({
                isVideo: true,
                preview: { key: previewKey, url: previewUrl },
                videos,
            });
        }

        const originalCandidates = await resolveOriginalCandidates(baseNoExt);

        const [originalResult, previewUrl, ...screenUrls] = await Promise.all([
            findFirstSignedUrl(originalCandidates, 60 * 3),
            getSignedUrlForKey(previewKey, 60 * 3).catch(() => null),
            ...screenKeys.map((k) =>
                getSignedUrlForKey(k, 60 * 3).catch(() => null),
            ),
        ]);

        res.json({
            original: originalResult
                ? { key: originalResult.key, url: originalResult.url }
                : null,
            preview: { key: previewKey, url: previewUrl },
            screen1280: { key: screenKeys[0], url: screenUrls[0] || null },
            screen1920: { key: screenKeys[1], url: screenUrls[1] || null },
            screen2560: { key: screenKeys[2], url: screenUrls[2] || null },
        });
        logAction(req, 'Get original', '#gallery.js #original #photo');
    } catch (err) {
        console.error('original error', err);
        res.status(500).json({ error: err.message || 'Internal error' });
        logAction(
            req,
            'Original error',
            `${err}
            #gallery.js #error`,
        );
    }
});

export default router;
