import express from 'express';
import { getSignedUrlForKey, getStableSignedUrl } from '../utils/s3Client.js';
import {
    parseNumericIndexFromBase,
    parseSoftDeleteBase,
} from '../utils/deletionMarker.js';
import { logAction } from '../utils/logger.js';
import {
    listCards,
    updateCardImageCount,
    updateCardPreviewKey,
    getCardByPath,
} from '../utils/cardsStore.js';
import path from 'path';
import { computeCardStats } from '../utils/galleryCardSync.js';
import {
    PREVIEW_ROOT,
    SCREEN_SIZES,
    VIDEO_SIZES,
    getFolderPreviews,
    getMediaEntry,
    splitFileName,
} from '../utils/folderListing.js';
import { getDimensionsByEtags } from '../utils/mediaDimensions.js';

const router = express.Router();

const ORIGINAL_ROOT = 'original_photo/';
const CARD_PREFIX_RE = /^\d{1,4}\/[A-Za-z]+$/;
const RELATIVE_MEDIA_KEY_RE =
    /^\d{1,4}\/[A-Za-z]+\/(?:video_)?[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;
const CARDS_S3_CONCURRENCY = 6;
const ORIGINAL_URL_TTL_SEC = 60 * 3;
const VIDEO_URL_TTL_SEC = 60 * 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function parseNonNegativeInt(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
                const folderPath = normalizeCardPathForS3(card.path);

                let imageCount = card.imageCount;
                let firstImageKey = null;
                let previewItems = [];

                try {
                    previewItems = await getFolderPreviews(folderPath);
                    const stats = computeCardStats(folderPath, previewItems);
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
                    const etag =
                        previewItems.find((item) => item.key === previewKey)
                            ?.etag || '';
                    try {
                        thumbnailUrl = await getStableSignedUrl(
                            previewKey,
                            etag,
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

        res.json({ cards });
    } catch (err) {
        console.error('cards error', err);
        // детали (бакет, ключи S3) только в лог, клиенту общий текст
        res.status(500).json({ error: 'Internal error' });
        logAction(
            req,
            'Cards error',
            `${err}
            #gallery.js #cards #error`,
        );
    }
});

// GET /api/gallery/previews?prefix=year/category/&limit=100&offset=0
// continuationToken поддерживается для совместимости и означает offset.
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

        const envDefaultLimit = Number.parseInt(
            String(process.env.PREVIEWS_DEFAULT_LIMIT || '5000'),
            10,
        );
        const envMaxLimit = Number.parseInt(
            String(process.env.PREVIEWS_MAX_LIMIT || '0'),
            10,
        );

        // resolve requested limit: query -> env default -> 200
        let requestedLimit = Number.parseInt(String(req.query.limit || ''), 10);
        if (!Number.isFinite(requestedLimit)) {
            requestedLimit = Number.isFinite(envDefaultLimit)
                ? envDefaultLimit
                : 200;
        }

        // envMaxLimit === 0 means "no max cap"
        if (Number.isFinite(envMaxLimit) && envMaxLimit > 0) {
            requestedLimit = Math.min(requestedLimit, envMaxLimit);
        }

        const noLimit = requestedLimit === 0; // 0 => disabled (fetch all)
        const offset =
            parseNonNegativeInt(req.query.offset) ??
            parseNonNegativeInt(req.query.continuationToken) ??
            0;
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

        const folderItems = await getFolderPreviews(normalizedPrefix);

        // фильтруем и сортируем весь список (дёшево), подписываем только страницу
        const entries = [];
        for (const obj of folderItems) {
            const { base: rawBase } = splitFileName(obj.key);
            const softDeleteMeta = parseSoftDeleteBase(rawBase);
            if (softDeleteMeta && !includeDeleted) {
                continue;
            }

            const displayBase =
                softDeleteMeta?.originalBase || String(rawBase || '');
            const isVideo = displayBase.startsWith('video_');
            entries.push({
                obj,
                softDeleteMeta,
                index: parseNumericIndexFromBase(displayBase) ?? 0,
                isVideo,
                name: isVideo
                    ? displayBase.replace(/^video_/, '')
                    : displayBase,
            });
        }
        entries.sort(
            (a, b) => a.index - b.index || a.obj.key.localeCompare(b.obj.key),
        );

        const total = entries.length;
        const page = noLimit
            ? entries.slice(offset)
            : entries.slice(offset, offset + Math.max(0, requestedLimit));

        const dimensions = await getDimensionsByEtags(
            page.map((entry) => entry.obj.etag),
        ).catch((err) => {
            console.error('Failed to read media dimensions', err.message);
            return new Map();
        });

        const items = await Promise.all(
            page.map(async (entry) => {
                const { obj, softDeleteMeta } = entry;
                const url = await getStableSignedUrl(obj.key, obj.etag).catch(
                    () => null,
                );
                const size = obj.etag ? dimensions.get(obj.etag) : null;

                const deleteDueAt = softDeleteMeta?.deleteAt || null;
                const deleteDaysLeft = deleteDueAt
                    ? Math.max(
                          0,
                          Math.ceil(
                              (deleteDueAt.getTime() - Date.now()) / DAY_MS,
                          ),
                      )
                    : null;

                return {
                    key: obj.key,
                    url,
                    index: entry.index,
                    size: obj.size || 0,
                    width: size?.width || null,
                    height: size?.height || null,
                    lastModified: obj.lastModified || null,
                    isVideo: entry.isVideo,
                    name: entry.name,
                    isPendingDeletion: Boolean(softDeleteMeta),
                    deleteDueAt: deleteDueAt ? deleteDueAt.toISOString() : null,
                    deleteDaysLeft,
                };
            }),
        );

        const nextOffset =
            offset + page.length < total ? offset + page.length : null;

        // название папки отдаём с первой страницей, чтобы клиенту не грузить /cards
        let title = null;
        if (offset === 0) {
            title = await getCardByPath(normalizedPrefix)
                .then((card) => card?.title || null)
                .catch(() => null);
            // только открытие папки, без каждого листания: журнал и статистика
            logAction(req, 'Открыл папку', normalizedPrefix, {
                notify: false,
                meta: { folder: normalizedPrefix },
            });
        }

        res.json({
            items,
            title,
            total,
            nextOffset,
            isTruncated: nextOffset !== null,
            nextContinuationToken:
                nextOffset !== null ? String(nextOffset) : null,
        });
    } catch (err) {
        console.error('previews error', err);
        // детали (бакет, ключи S3) только в лог, клиенту общий текст
        res.status(500).json({ error: 'Internal error' });
        logAction(
            req,
            'Previews error',
            `${err}
            #gallery.js #previews #error`,
        );
    }
});

/**
 * key вида year/category/1.jpg, preview/... или original_photo/...
 * @returns {{baseNoExt: string, folderPath: string, baseNameOnly: string, isVideo: boolean}|null}
 */
function parseMediaKey(rawKey) {
    const key = String(rawKey || '')
        .replace(/^\/+/, '')
        .replace(/\.\./g, '');
    let relative = key;
    if (key.startsWith(ORIGINAL_ROOT)) {
        relative = key.slice(ORIGINAL_ROOT.length);
    } else if (key.startsWith(PREVIEW_ROOT)) {
        relative = key.slice(PREVIEW_ROOT.length);
    }

    relative = relative.replace(/^\/+/, '');
    if (!RELATIVE_MEDIA_KEY_RE.test(relative)) {
        return null;
    }

    const ext = path.posix.extname(relative);
    const baseNoExt = ext ? relative.slice(0, -ext.length) : relative;
    const baseNameOnly = path.posix.basename(baseNoExt); // e.g. "video_12345" or "12345"
    return {
        baseNoExt,
        folderPath: path.posix.dirname(baseNoExt), // e.g. "2024/event"
        baseNameOnly,
        isVideo: baseNameOnly.startsWith('video_'),
    };
}

// GET /api/gallery/download?key=... — скачать оригинал (или лучшее видео).
// Ссылка на S3 подписывается в момент нажатия, поэтому кнопка HD работает,
// сколько бы фото ни было открыто (ссылки из /original живут 3 минуты).
router.get('/download', async (req, res) => {
    try {
        const media = parseMediaKey(req.query.key);
        if (!media) {
            return res.status(400).json({ error: 'Некорректный key' });
        }

        const entry = await getMediaEntry(media.folderPath, media.baseNameOnly);
        let targetKey = null;
        if (media.isVideo) {
            const size = VIDEO_SIZES.find((s) => (entry?.v || []).includes(s));
            const bareBase = media.baseNameOnly.replace(/^video_/, '');
            targetKey = size
                ? `video_${size}/${media.folderPath}/${bareBase}.mp4`
                : null;
        } else {
            targetKey = entry?.o || null;
        }
        if (!targetKey) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        const url = await getSignedUrlForKey(
            targetKey,
            media.isVideo ? VIDEO_URL_TTL_SEC : ORIGINAL_URL_TTL_SEC,
            { skipHead: true },
        );
        logAction(req, 'Открыл оригинал', targetKey, {
            notify: false,
            meta: { key: targetKey },
        });
        res.set('Cache-Control', 'no-store');
        return res.redirect(url);
    } catch (err) {
        console.error('download error', err);
        return res.status(500).json({ error: 'Internal error' });
    }
});

// GET /api/gallery/original?key=year/category/1.jpg  or key=original/year/..
// Ссылки строятся по индексу медиа папки (Redis), без запросов к S3.
router.get('/original', async (req, res) => {
    try {
        if (!req.query.key) {
            return res.status(400).json({ error: 'key required' });
        }
        const media = parseMediaKey(req.query.key);
        if (!media) {
            return res.status(400).json({
                error: 'Некорректный key. Используйте формат "year/category/file.ext"',
            });
        }
        const { baseNoExt, folderPath, baseNameOnly, isVideo } = media;

        const entry = await getMediaEntry(folderPath, baseNameOnly);
        const version = entry?.e || '';

        const previewKey = `${PREVIEW_ROOT}${baseNoExt}.webp`;
        const previewUrl = await getStableSignedUrl(previewKey, version).catch(
            (e) => {
                console.error('preview signed url failed', previewKey, e);
                return null;
            },
        );

        if (isVideo) {
            // preview оставляем с video_ в названии,
            // а ключи к .mp4 строим без префикса video_
            const bareBase = baseNameOnly.replace(/^video_/, '');
            const available = new Set(entry?.v || []);

            const videos = {};
            await Promise.all(
                VIDEO_SIZES.map(async (size) => {
                    const videoKey = `video_${size}/${folderPath}/${bareBase}.mp4`;
                    const url = available.has(size)
                        ? await getSignedUrlForKey(
                              videoKey,
                              VIDEO_URL_TTL_SEC,
                              {
                                  skipHead: true,
                              },
                          ).catch(() => null)
                        : null;
                    videos[size] = { key: videoKey, url };
                }),
            );

            return res.json({
                isVideo: true,
                preview: { key: previewKey, url: previewUrl },
                videos,
            });
        }

        const original = entry?.o
            ? {
                  key: entry.o,
                  url: await getSignedUrlForKey(entry.o, ORIGINAL_URL_TTL_SEC, {
                      skipHead: true,
                  }).catch(() => null),
              }
            : null;

        const availableScreens = new Set(entry?.s || []);
        const screens = {};
        await Promise.all(
            SCREEN_SIZES.map(async (size) => {
                const screenKey = `screen-${size}/${baseNoExt}.webp`;
                const url = availableScreens.has(size)
                    ? await getStableSignedUrl(screenKey, version).catch(
                          () => null,
                      )
                    : null;
                screens[`screen${size}`] = { key: screenKey, url };
            }),
        );

        res.json({
            original: original?.url ? original : null,
            preview: { key: previewKey, url: previewUrl },
            ...screens,
        });
    } catch (err) {
        console.error('original error', err);
        res.status(500).json({ error: 'Internal error' });
        logAction(
            req,
            'Original error',
            `${err}
            #gallery.js #error`,
        );
    }
});

export default router;
