import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import {
    uploadToS3,
    listObjects,
    getSignedUrlForKey,
    getObjectBufferFromS3,
    headObjectMeta,
} from '../utils/s3Client.js';
import {
    listCards,
    createCard,
    updateCard,
    deleteCard,
    parseCardPath,
} from '../utils/cardsStore.js';
import {
    ensureCardExists,
    syncCardByPath,
    normalizePreviewInput,
} from '../utils/galleryCardSync.js';
import {
    buildSoftDeletedBase,
    getSoftDeleteRetentionDays,
    parseSoftDeleteBase,
    parseNumericIndexFromBase,
} from '../utils/deletionMarker.js';
import { publishPhotoJob } from '../utils/rabbitmq.js';
import { logAction } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

const router = express.Router();

const DEFAULT_MAX_UPLOAD_MB = 20;
const rawMaxUploadMb = Number(
    process.env.MAX_UPLOAD_MB || DEFAULT_MAX_UPLOAD_MB,
);
const MAX_UPLOAD_BYTES =
    Number.isFinite(rawMaxUploadMb) && rawMaxUploadMb > 0
        ? Math.floor(rawMaxUploadMb * 1024 * 1024)
        : DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/tiff',
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        void req;
        const mimeType = String(file?.mimetype || '').toLowerCase();
        if (!ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
            return cb(new Error('Unsupported file type'));
        }
        return cb(null, true);
    },
});

sharp.concurrency(1);
sharp.cache(false);

const PREVIEW_ROOT = 'preview/';
const ORIGINAL_ROOT = 'original_photo/';
const SCREEN_DIRS = ['screen-1280', 'screen-1920', 'screen-2560'];
const VIDEO_DIRS = ['video_1440', 'video_1080', 'video_720'];
const PROCESSING_SOURCE_ROOT = 'processing/source/';
const REORDER_STATUS_ROOT = 'processing/reorder/';
const CARDS_S3_CONCURRENCY = 4;
const REORDER_S3_CONCURRENCY = 8;
const PENDING_DELETE_S3_CONCURRENCY = 6;
const MEDIA_FILE_RE = /\.(jpe?g|png|webp|avif|gif|mp4|tiff?)$/i;
const SOFT_DELETE_JOB_TYPE = 'gallery-soft-delete';
const SOFT_DELETE_ACTION_DELETE = 'delete';
const SOFT_DELETE_ACTION_RESTORE = 'restore';
const SOFT_DELETE_RETENTION_DAYS = getSoftDeleteRetentionDays();

function makeNumericName(req) {
    const now = BigInt(Date.now());
    if (!req.app.locals._uploadSeq) {
        req.app.locals._uploadSeq = 0n;
    }
    req.app.locals._uploadSeq = (req.app.locals._uploadSeq + 1n) % 1000n;
    return String(now * 1000n + req.app.locals._uploadSeq);
}

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

function normalizeEtag(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/^"+|"+$/g, '');
    return normalized || null;
}

function sanitizeS3Key(value) {
    return String(value || '')
        .trim()
        .replace(/^\/+/, '')
        .replace(/\.\./g, '');
}

function stripExt(name) {
    const ext = path.posix.extname(name);
    return ext ? name.slice(0, -ext.length) : name;
}

function parseSortableIndexFromKey(key) {
    const baseWithExt = path.posix.basename(String(key || ''));
    const baseNoExt = stripExt(baseWithExt);
    const parsed = parseNumericIndexFromBase(baseNoExt);
    if (!Number.isFinite(parsed)) {
        return Number.MAX_SAFE_INTEGER;
    }
    return parsed;
}

function comparePreviewObjects(a, b) {
    const ai = parseSortableIndexFromKey(a?.Key || '');
    const bi = parseSortableIndexFromKey(b?.Key || '');
    if (ai !== bi) {
        return ai - bi;
    }
    return String(a?.Key || '').localeCompare(String(b?.Key || ''));
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

function extractVariantFromKey(key, folderPath) {
    const cleanKey = sanitizeS3Key(key);
    const roots = [
        { type: 'preview', prefix: `${PREVIEW_ROOT}${folderPath}/` },
        ...SCREEN_DIRS.map((dir) => ({
            type: dir,
            prefix: `${dir}/${folderPath}/`,
        })),
        { type: 'original', prefix: `${ORIGINAL_ROOT}${folderPath}/` },
        ...VIDEO_DIRS.map((dir) => ({
            type: dir,
            prefix: `${dir}/${folderPath}/`,
        })),
    ];

    for (const root of roots) {
        if (!cleanKey.startsWith(root.prefix)) {
            continue;
        }
        const relative = cleanKey.slice(root.prefix.length);
        if (
            !relative ||
            relative.includes('/') ||
            relative === '.placeholder'
        ) {
            return null;
        }
        const ext = path.posix.extname(relative);
        if (!ext) {
            return null;
        }
        const rawBase = stripExt(relative);
        let groupBase = rawBase;
        if (
            root.type.startsWith('video_') &&
            !rawBase.startsWith('video_') &&
            !rawBase.startsWith('delete_')
        ) {
            groupBase = `video_${rawBase}`;
        }
        return {
            type: root.type,
            key: cleanKey,
            ext,
            groupBase,
        };
    }

    return null;
}

function buildTargetKeyForVariant(variant, folderPath, targetBase) {
    const ext = String(variant.ext || '').toLowerCase() || '.webp';
    if (variant.type === 'preview') {
        return `${PREVIEW_ROOT}${folderPath}/${targetBase}${ext}`;
    }
    if (variant.type === 'original') {
        return `${ORIGINAL_ROOT}${folderPath}/${targetBase}${ext}`;
    }
    if (SCREEN_DIRS.includes(variant.type)) {
        return `${variant.type}/${folderPath}/${targetBase}${ext}`;
    }
    if (VIDEO_DIRS.includes(variant.type)) {
        const bareBase = targetBase.replace(/^video_/, '');
        return `${variant.type}/${folderPath}/${bareBase}${ext}`;
    }
    throw new Error(`Unknown variant type: ${variant.type}`);
}

function parsePreviewBaseFromKey(key, folderPath) {
    const clean = sanitizeS3Key(key);
    const prefix = `${PREVIEW_ROOT}${folderPath}/`;
    if (!clean.startsWith(prefix)) {
        return null;
    }
    const relative = clean.slice(prefix.length);
    if (!relative || relative.includes('/')) {
        return null;
    }
    return stripExt(relative);
}

function parsePendingDeletePreviewMeta(previewKey) {
    const key = sanitizeS3Key(previewKey);
    if (!key.startsWith(PREVIEW_ROOT)) {
        return null;
    }

    const relative = key.slice(PREVIEW_ROOT.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length !== 3) {
        return null;
    }

    const folderPathCandidate = `${parts[0] || ''}/${parts[1] || ''}`;
    const parsedFolderPath = parseCardPath(folderPathCandidate);
    if (!parsedFolderPath) {
        return null;
    }

    const fileName = parts[2] || '';
    const ext = path.posix.extname(fileName);
    if (!ext) {
        return null;
    }

    const rawBase = stripExt(fileName);
    const softDeleteMeta = parseSoftDeleteBase(rawBase);
    if (!softDeleteMeta) {
        return null;
    }

    const displayBase = softDeleteMeta.originalBase;
    const isVideo = displayBase.startsWith('video_');
    const name = isVideo ? displayBase.replace(/^video_/, '') : displayBase;
    const deleteDueAt = softDeleteMeta.deleteAt;
    const deleteCreatedAt = softDeleteMeta.deleteCreatedAt || null;
    const deleteDaysLeft = Math.max(
        0,
        Math.ceil((deleteDueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );

    return {
        key,
        folderPath: parsedFolderPath.path,
        name,
        isVideo,
        deleteDueAt: deleteDueAt.toISOString(),
        deleteCreatedAt: deleteCreatedAt ? deleteCreatedAt.toISOString() : null,
        deleteDaysLeft,
    };
}

function isSoftDeletedPreviewKey(key, folderPath) {
    const base = parsePreviewBaseFromKey(key, folderPath);
    if (!base) {
        return false;
    }
    return Boolean(parseSoftDeleteBase(base));
}

function normalizeSoftDeleteAction(value) {
    const action = String(value || '')
        .trim()
        .toLowerCase();
    if (action === SOFT_DELETE_ACTION_DELETE) {
        return SOFT_DELETE_ACTION_DELETE;
    }
    if (action === SOFT_DELETE_ACTION_RESTORE) {
        return SOFT_DELETE_ACTION_RESTORE;
    }
    return null;
}

function makeSoftDeleteJobId() {
    return `sd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeReorderJobId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseOrderKeyEntry(entry) {
    if (typeof entry === 'string') {
        return sanitizeS3Key(entry);
    }
    if (entry && typeof entry === 'object' && typeof entry.key === 'string') {
        return sanitizeS3Key(entry.key);
    }
    return '';
}

function toCardResponse(card, extra = {}) {
    const parsedPath = parseCardPath(card.path);
    return {
        id: card.id,
        path: card.path,
        year: card.year,
        category: parsedPath?.category || '',
        title: card.title,
        imageCount: card.imageCount,
        sortOrder: card.sortOrder,
        previewKey: card.previewKey,
        thumbnailUrl: extra.thumbnailUrl || null,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
    };
}

function isValidationError(err) {
    const message = String(err?.message || '');
    return (
        message.includes('Invalid') ||
        message.includes('required') ||
        message.includes('must')
    );
}

function resolveValidationMessage(
    err,
    fallback = 'Некорректные данные запроса',
) {
    const message = String(err?.message || '').trim();
    if (!message) {
        return fallback;
    }
    return /[А-Яа-яЁё]/.test(message) ? message : fallback;
}

async function signPreviewUrl(previewKey) {
    const normalizedPreviewKey = normalizePreviewInput(previewKey);
    if (!normalizedPreviewKey) {
        return null;
    }
    try {
        return await getSignedUrlForKey(normalizedPreviewKey, 60 * 5, {
            skipHead: true,
        });
    } catch (err) {
        console.error(
            'Failed to sign card preview key',
            normalizedPreviewKey,
            err,
        );
        return null;
    }
}

router.get('/cards-admin', async (req, res) => {
    try {
        const storedCards = await listCards();
        const cards = await mapWithConcurrency(
            storedCards,
            CARDS_S3_CONCURRENCY,
            async (card) => {
                try {
                    const synced = await syncCardByPath(card.path);
                    const thumbnailUrl = await signPreviewUrl(
                        synced.previewKey,
                    );
                    return toCardResponse(synced, { thumbnailUrl });
                } catch (err) {
                    console.error('Failed to enrich card for admin list', err);
                    const thumbnailUrl = await signPreviewUrl(card.previewKey);
                    return toCardResponse(card, { thumbnailUrl });
                }
            },
        );

        sendSuccess(res, {
            message: 'Карточки загружены',
            payload: { cards },
        });
        logAction(req, 'Get cards-admin', '#galleryEdit.js #cards-admin');
    } catch (err) {
        console.error('cards-admin error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось загрузить карточки',
        });
        logAction(
            req,
            'cards-admin error',
            `${err}
            #galleryEdit.js #cards-admin #error`,
        );
    }
});

router.post('/cards-admin', async (req, res) => {
    try {
        const body = req.body || {};
        const pathFromBody =
            body.path ||
            `${String(body.year || '').trim()}/${String(body.category || '').trim()}`;
        const parsedPath = parseCardPath(pathFromBody);
        if (!parsedPath) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Некорректный path. Используйте формат "year/category"',
            });
        }

        const title = String(body.title ?? parsedPath.category).trim();
        if (!title) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Название карточки обязательно',
            });
        }

        const previewKey = normalizePreviewInput(body.previewKey);
        const created = await createCard({
            path: parsedPath.path,
            year: body.year ?? parsedPath.year,
            title,
            sortOrder: body.sortOrder,
            previewKey,
            imageCount: 0,
        });

        const synced = await syncCardByPath(created.path, previewKey);
        const thumbnailUrl = await signPreviewUrl(synced.previewKey);

        sendSuccess(res, {
            httpStatus: 201,
            message: 'Карточка создана',
            payload: {
                card: toCardResponse(synced, { thumbnailUrl }),
            },
        });
        logAction(
            req,
            'Created card',
            `${synced.path}
            #galleryEdit.js #cards-admin #create`,
        );
    } catch (err) {
        if (err?.code === '23505') {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message: 'Карточка с таким путём уже есть',
            });
        }
        if (isValidationError(err)) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: resolveValidationMessage(err),
            });
        }
        console.error('create card error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось создать карточку',
        });
    }
});

router.put('/cards-admin/:id', async (req, res) => {
    try {
        const patch = { ...(req.body || {}) };

        if (patch.path === undefined && patch.year && patch.category) {
            patch.path = `${String(patch.year).trim()}/${String(
                patch.category,
            ).trim()}`;
        }

        if (patch.path !== undefined) {
            const parsedPath = parseCardPath(patch.path);
            if (!parsedPath) {
                return sendError(res, {
                    httpStatus: 400,
                    status: 'warning',
                    message:
                        'Некорректный path. Используйте формат "year/category"',
                });
            }
            patch.path = parsedPath.path;
            if (
                patch.year === undefined ||
                patch.year === null ||
                patch.year === ''
            ) {
                patch.year = parsedPath.year;
            }
        }

        if (patch.previewKey !== undefined) {
            patch.previewKey = normalizePreviewInput(patch.previewKey);
        }

        const updated = await updateCard(req.params.id, patch);
        if (!updated) {
            return sendError(res, {
                httpStatus: 404,
                status: 'warning',
                message: 'Карточка не найдена',
            });
        }

        const synced = await syncCardByPath(updated.path, patch.previewKey);
        const thumbnailUrl = await signPreviewUrl(synced.previewKey);

        sendSuccess(res, {
            message: 'Карточка обновлена',
            payload: { card: toCardResponse(synced, { thumbnailUrl }) },
        });
        logAction(
            req,
            'Updated card',
            `${synced.path}
            #galleryEdit.js #cards-admin #update`,
        );
    } catch (err) {
        if (err?.code === '23505') {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message: 'Карточка с таким путём уже есть',
            });
        }
        if (isValidationError(err)) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: resolveValidationMessage(err),
            });
        }
        console.error('update card error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось обновить карточку',
        });
    }
});

router.delete('/cards-admin/:id', async (req, res) => {
    try {
        const deleted = await deleteCard(req.params.id);
        if (!deleted) {
            return sendError(res, {
                httpStatus: 404,
                status: 'warning',
                message: 'Карточка не найдена',
            });
        }
        sendSuccess(res, {
            message: 'Карточка удалена',
            payload: { card: toCardResponse(deleted) },
        });
        logAction(
            req,
            'Deleted card',
            `${deleted.path}
            #galleryEdit.js #cards-admin #delete`,
        );
    } catch (err) {
        if (isValidationError(err)) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: resolveValidationMessage(err),
            });
        }
        console.error('delete card error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось удалить карточку',
        });
    }
});

router.post('/upload', upload.single('image'), async (req, res) => {
    let statusKey = null;
    try {
        const parsedFolderPath = parseCardPath(req.body.path);
        if (!parsedFolderPath) {
            logAction(req, 'Missing path', '#galleryEdit.js #upload #error');
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Некорректный path. Используйте формат "year/category"',
            });
        }

        const folderPath = parsedFolderPath.path;

        if (!req.file) {
            logAction(
                req,
                'No file uploaded',
                '#galleryEdit.js #upload #error',
            );
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Файл не загружен',
            });
        }

        await ensureCardExists(folderPath);

        const isVideo = String(req.body.video || '').toLowerCase();
        const videoFlag = isVideo === 'true';

        const buffer = req.file.buffer;
        let baseName = makeNumericName(req);
        if (videoFlag) {
            baseName = `video_${baseName}`;
        }

        const origExt = path.extname(req.file.originalname) || '.jpg';
        const originalKey = `${ORIGINAL_ROOT}${folderPath}/${baseName}${origExt}`;
        const sourceKey = videoFlag
            ? `${PROCESSING_SOURCE_ROOT}${folderPath}/${baseName}${origExt}`
            : originalKey;
        statusKey = `processing/${folderPath}/${baseName}.json`;

        await uploadToS3(buffer, sourceKey);

        await uploadToS3(
            Buffer.from(
                JSON.stringify({
                    status: 'queued',
                    queuedAt: new Date().toISOString(),
                }),
            ),
            statusKey,
            'application/json',
        );

        sendSuccess(res, {
            httpStatus: 200,
            status: 'success',
            message: 'Файл загружен и поставлен в обработку',
            payload: {
                success: true,
                filename: baseName,
                statusKey,
            },
        });
        logAction(
            req,
            'Uploaded new file',
            `${baseName}
            #galleryEdit.js #upload`,
        );

        void (async () => {
            try {
                await publishPhotoJob({
                    folderPath,
                    baseName,
                    sourceKey,
                    originalKey: videoFlag ? null : originalKey,
                    statusKey,
                    videoFlag,
                    cleanupSource: videoFlag,
                });
            } catch (publishErr) {
                console.error('Failed to publish upload job:', publishErr);
                if (statusKey) {
                    try {
                        await uploadToS3(
                            Buffer.from(
                                JSON.stringify({
                                    status: 'error',
                                    error: String(publishErr),
                                    at: new Date().toISOString(),
                                }),
                            ),
                            statusKey,
                            'application/json',
                        );
                    } catch (statusErr) {
                        console.error(
                            'Failed to write publish error status:',
                            statusErr,
                        );
                    }
                }
                logAction(
                    req,
                    'Upload publish failed',
                    `${publishErr}
                    #galleryEdit.js #upload #publish-error`,
                );
            }
        })();
        return;
    } catch (err) {
        console.error('Upload route error:', err);
        if (statusKey) {
            try {
                await uploadToS3(
                    Buffer.from(
                        JSON.stringify({
                            status: 'error',
                            error: String(err),
                            at: new Date().toISOString(),
                        }),
                    ),
                    statusKey,
                    'application/json',
                );
            } catch (statusErr) {
                console.error(
                    'Failed to write upload error status:',
                    statusErr,
                );
            }
        }
        if (!res.headersSent) {
            sendError(res, {
                httpStatus: 500,
                message: 'Не удалось загрузить файл',
            });
            logAction(
                req,
                'Upload failed',
                `${err}
                #galleryEdit.js #upload #error`,
            );
        }
    }
});

router.post('/media-soft-delete', async (req, res) => {
    try {
        const body = req.body || {};
        const parsedFolderPath = parseCardPath(body.path || body.prefix || '');
        if (!parsedFolderPath) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Некорректный path. Используйте формат "year/category"',
            });
        }

        const folderPath = parsedFolderPath.path;
        const action = normalizeSoftDeleteAction(body.action);
        if (!action) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Некорректное действие. Используйте delete или restore',
            });
        }

        const previewKey = sanitizeS3Key(body.key || body.previewKey || '');
        const expectedPreviewPrefix = `${PREVIEW_ROOT}${folderPath}/`;
        if (!previewKey.startsWith(expectedPreviewPrefix)) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Ключ изображения должен относиться к текущей папке preview',
            });
        }

        const sourceGroupBase = parsePreviewBaseFromKey(previewKey, folderPath);
        if (!sourceGroupBase) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Некорректный preview key',
            });
        }

        const sourceDeleteMeta = parseSoftDeleteBase(sourceGroupBase);
        if (action === SOFT_DELETE_ACTION_DELETE && sourceDeleteMeta) {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message: 'Изображение уже помечено на удаление',
            });
        }
        if (action === SOFT_DELETE_ACTION_RESTORE && !sourceDeleteMeta) {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message: 'Изображение не находится в статусе удаления',
            });
        }

        await ensureCardExists(folderPath);

        let targetGroupBase = sourceGroupBase;
        if (action === SOFT_DELETE_ACTION_DELETE) {
            targetGroupBase = buildSoftDeletedBase(sourceGroupBase, {
                retentionDays: SOFT_DELETE_RETENTION_DAYS,
            });
        } else if (sourceDeleteMeta) {
            targetGroupBase = sourceDeleteMeta.originalBase;
        }

        const prefixes = [
            `${PREVIEW_ROOT}${folderPath}/`,
            ...SCREEN_DIRS.map((dir) => `${dir}/${folderPath}/`),
            `${ORIGINAL_ROOT}${folderPath}/`,
            ...VIDEO_DIRS.map((dir) => `${dir}/${folderPath}/`),
        ];

        const listed = await Promise.all(
            prefixes.map(async (prefix) => {
                const objects = await listAllObjectsForPrefix(prefix);
                return objects.filter((obj) => isFileObject(obj, prefix));
            }),
        );

        const allObjects = listed.flat().filter(Boolean);
        const existingKeySet = new Set(
            allObjects.map((obj) => sanitizeS3Key(obj?.Key)),
        );

        const sourceVariants = (
            await mapWithConcurrency(
                allObjects,
                REORDER_S3_CONCURRENCY,
                async (obj) => {
                    const variant = extractVariantFromKey(obj?.Key, folderPath);
                    if (!variant || variant.groupBase !== sourceGroupBase) {
                        return null;
                    }

                    let hash = normalizeEtag(obj?.ETag);
                    let size = Number(obj?.Size) || 0;
                    if (!hash) {
                        const meta = await headObjectMeta(variant.key, {
                            silentNotFound: true,
                        });
                        hash = normalizeEtag(meta?.etag);
                        size = Number(meta?.size) || size;
                    }
                    if (!hash) {
                        throw new Error(
                            `Не удалось получить hash для объекта ${variant.key}`,
                        );
                    }

                    return {
                        ...variant,
                        hash,
                        size,
                    };
                },
            )
        ).filter(Boolean);

        if (sourceVariants.length === 0) {
            return sendError(res, {
                httpStatus: 404,
                status: 'warning',
                message:
                    'Не удалось найти файлы изображения для переименования',
            });
        }

        const sourceKeySet = new Set(sourceVariants.map((item) => item.key));
        const targetKeySet = new Set();
        const moves = [];

        for (const variant of sourceVariants) {
            const targetKey = sanitizeS3Key(
                buildTargetKeyForVariant(variant, folderPath, targetGroupBase),
            );

            if (!targetKey) {
                continue;
            }

            if (targetKeySet.has(targetKey)) {
                throw new Error(`duplicate target key generated: ${targetKey}`);
            }
            targetKeySet.add(targetKey);

            if (
                targetKey !== variant.key &&
                !sourceKeySet.has(targetKey) &&
                existingKeySet.has(targetKey)
            ) {
                return sendError(res, {
                    httpStatus: 409,
                    status: 'warning',
                    message:
                        'Целевое имя уже занято. Обновите список и повторите действие.',
                });
            }

            moves.push({
                sourceKey: variant.key,
                targetKey,
                hash: variant.hash,
                size: variant.size,
            });
        }

        if (moves.length === 0) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Не найдено файлов для переименования',
            });
        }

        const queuedAt = new Date().toISOString();
        const jobId = makeSoftDeleteJobId();
        const deleteMeta =
            action === SOFT_DELETE_ACTION_DELETE
                ? parseSoftDeleteBase(targetGroupBase)
                : null;

        await publishPhotoJob({
            jobType: SOFT_DELETE_JOB_TYPE,
            action,
            jobId,
            queuedAt,
            folderPath,
            sourceGroupBase,
            targetGroupBase,
            moves,
        });

        sendSuccess(res, {
            httpStatus: 202,
            status: 'accepted',
            message:
                action === SOFT_DELETE_ACTION_DELETE
                    ? `Изображение помечено на удаление. Автоудаление через ${SOFT_DELETE_RETENTION_DAYS} дней.`
                    : 'Удаление отменено. Возвращаем исходное имя.',
            payload: {
                action,
                jobId,
                queuedAt,
                totalMoves: moves.length,
                deleteDueAt: deleteMeta?.deleteAt?.toISOString() || null,
                deleteDueDateToken: deleteMeta?.deleteAtToken || null,
            },
        });
        logAction(
            req,
            'accepted media soft-delete action',
            `${action} ${folderPath} ${previewKey}
            #galleryEdit.js #media-soft-delete`,
        );
    } catch (err) {
        console.error('media-soft-delete route error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось отправить задачу удаления изображения',
        });
    }
});

router.get('/pending-deletions', async (req, res) => {
    try {
        const parsedLimit = Number.parseInt(req.query.limit || '500', 10);
        const limit =
            Number.isInteger(parsedLimit) && parsedLimit > 0
                ? Math.min(parsedLimit, 1000)
                : 500;
        const continuationToken = String(
            req.query.continuationToken || '',
        ).trim();

        const page = await listObjects(
            PREVIEW_ROOT,
            limit,
            continuationToken || undefined,
        );
        const contents = Array.isArray(page?.Contents) ? page.Contents : [];

        const pendingItemsRaw = await mapWithConcurrency(
            contents,
            PENDING_DELETE_S3_CONCURRENCY,
            async (obj) => {
                const key = sanitizeS3Key(obj?.Key);
                if (!key || key.endsWith('/')) {
                    return null;
                }

                const parsed = parsePendingDeletePreviewMeta(key);
                if (!parsed) {
                    return null;
                }

                const url = await getSignedUrlForKey(key, 60 * 5, {
                    skipHead: true,
                });
                return {
                    ...parsed,
                    url,
                    size: Number(obj?.Size) || 0,
                    lastModified: obj?.LastModified || null,
                };
            },
        );

        const items = pendingItemsRaw.filter(Boolean).sort((a, b) => {
            const dueA = Date.parse(a.deleteDueAt || '');
            const dueB = Date.parse(b.deleteDueAt || '');
            if (
                Number.isFinite(dueA) &&
                Number.isFinite(dueB) &&
                dueA !== dueB
            ) {
                return dueA - dueB;
            }
            return String(a.key || '').localeCompare(String(b.key || ''));
        });

        sendSuccess(res, {
            message: 'Список фото под удалением загружен',
            payload: {
                items,
                isTruncated: Boolean(page?.IsTruncated),
                nextContinuationToken: page?.NextContinuationToken || null,
            },
        });
    } catch (err) {
        console.error('pending-deletions route error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось загрузить список фото под удалением',
        });
    }
});

router.post('/reorder', async (req, res) => {
    let statusKey = null;
    try {
        const body = req.body || {};
        const parsedFolderPath = parseCardPath(body.path || body.prefix || '');
        if (!parsedFolderPath) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Некорректный path. Используйте формат "year/category"',
            });
        }

        const folderPath = parsedFolderPath.path;
        const rawOrder = Array.isArray(body.order) ? body.order : [];
        if (rawOrder.length === 0) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Передайте порядок фотографий в поле order[]',
            });
        }

        const requestedOrder = rawOrder.map(parseOrderKeyEntry);
        if (requestedOrder.some((key) => !key)) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Некорректные ключи в order[]',
            });
        }

        const requestedOrderSet = new Set(requestedOrder);
        if (requestedOrderSet.size !== requestedOrder.length) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'В order[] есть дубли',
            });
        }

        await ensureCardExists(folderPath);

        const previewPrefix = `${PREVIEW_ROOT}${folderPath}/`;
        const previewObjects = (
            await listAllObjectsForPrefix(previewPrefix)
        ).filter(
            (obj) =>
                isFileObject(obj, previewPrefix) &&
                !isSoftDeletedPreviewKey(obj?.Key, folderPath),
        );
        if (previewObjects.length === 0) {
            return sendError(res, {
                httpStatus: 404,
                status: 'warning',
                message: 'В папке нет фотографий для сортировки',
            });
        }

        previewObjects.sort(comparePreviewObjects);
        const existingPreviewKeys = previewObjects.map((obj) =>
            sanitizeS3Key(obj.Key),
        );
        const existingPreviewSet = new Set(existingPreviewKeys);

        if (requestedOrder.length !== existingPreviewKeys.length) {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message:
                    'Порядок не совпадает с текущим составом галереи. Обновите страницу и попробуйте снова.',
            });
        }

        const expectedPreviewPrefix = `${PREVIEW_ROOT}${folderPath}/`;
        for (const key of requestedOrder) {
            if (!key.startsWith(expectedPreviewPrefix)) {
                return sendError(res, {
                    httpStatus: 400,
                    status: 'warning',
                    message: 'order[] содержит ключи из другой папки',
                });
            }
            if (!existingPreviewSet.has(key)) {
                return sendError(res, {
                    httpStatus: 409,
                    status: 'warning',
                    message:
                        'Список фотографий устарел. Обновите страницу и повторите действие.',
                });
            }
        }

        const otherPrefixes = [
            ...SCREEN_DIRS.map((dir) => `${dir}/${folderPath}/`),
            `${ORIGINAL_ROOT}${folderPath}/`,
            ...VIDEO_DIRS.map((dir) => `${dir}/${folderPath}/`),
        ];

        const otherLists = await Promise.all(
            otherPrefixes.map(async (prefix) => {
                const listed = await listAllObjectsForPrefix(prefix);
                return listed.filter((obj) => isFileObject(obj, prefix));
            }),
        );

        const allVariantObjects = [
            ...previewObjects,
            ...otherLists.flat(),
        ].filter(Boolean);

        const preparedVariants = await mapWithConcurrency(
            allVariantObjects,
            REORDER_S3_CONCURRENCY,
            async (obj) => {
                const variant = extractVariantFromKey(obj?.Key, folderPath);
                if (!variant) {
                    return null;
                }

                let hash = normalizeEtag(obj?.ETag);
                let size = Number(obj?.Size) || 0;
                if (!hash) {
                    const meta = await headObjectMeta(variant.key, {
                        silentNotFound: true,
                    });
                    hash = normalizeEtag(meta?.etag);
                    size = Number(meta?.size) || size;
                }
                if (!hash) {
                    throw new Error(
                        `Не удалось получить hash для объекта ${variant.key}`,
                    );
                }

                return {
                    ...variant,
                    hash,
                    size,
                };
            },
        );

        const variantsByBase = new Map();
        const seenVariantKeys = new Set();
        for (const entry of preparedVariants) {
            if (!entry) {
                continue;
            }
            if (seenVariantKeys.has(entry.key)) {
                continue;
            }
            seenVariantKeys.add(entry.key);
            const list = variantsByBase.get(entry.groupBase) || [];
            list.push(entry);
            variantsByBase.set(entry.groupBase, list);
        }

        const moves = [];
        for (let idx = 0; idx < requestedOrder.length; idx += 1) {
            const sourcePreviewKey = requestedOrder[idx];
            const sourceBase = parsePreviewBaseFromKey(
                sourcePreviewKey,
                folderPath,
            );
            if (!sourceBase) {
                return sendError(res, {
                    httpStatus: 400,
                    status: 'warning',
                    message: `Некорректный preview key: ${sourcePreviewKey}`,
                });
            }

            const sourceVariants = variantsByBase.get(sourceBase) || [];
            if (sourceVariants.length === 0) {
                return sendError(res, {
                    httpStatus: 409,
                    status: 'warning',
                    message:
                        'Не удалось собрать копии файлов для сортировки. Обновите страницу и попробуйте снова.',
                });
            }

            const targetIndex = idx + 1;
            const targetBase = sourceBase.startsWith('video_')
                ? `video_${targetIndex}`
                : String(targetIndex);

            for (const variant of sourceVariants) {
                const targetKey = sanitizeS3Key(
                    buildTargetKeyForVariant(variant, folderPath, targetBase),
                );

                moves.push({
                    sourceKey: variant.key,
                    targetKey,
                    hash: variant.hash,
                    size: variant.size,
                });
            }
        }

        if (moves.length === 0) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Не найдено файлов для переименования',
            });
        }

        const jobId = makeReorderJobId();
        const queuedAt = new Date().toISOString();
        statusKey = `${REORDER_STATUS_ROOT}${folderPath}/${jobId}.json`;

        await uploadToS3(
            Buffer.from(
                JSON.stringify({
                    status: 'queued',
                    stage: 'queued',
                    queuedAt,
                    jobId,
                    folderPath,
                    totalItems: requestedOrder.length,
                    totalMoves: moves.length,
                }),
            ),
            statusKey,
            'application/json',
        );

        await publishPhotoJob({
            jobType: 'gallery-reorder',
            jobId,
            folderPath,
            statusKey,
            queuedAt,
            totalItems: requestedOrder.length,
            moves,
        });

        sendSuccess(res, {
            httpStatus: 202,
            status: 'accepted',
            message:
                'Перестановка принята в обработку. Идёт переименование и проверка hash.',
            payload: {
                statusKey,
                jobId,
                totalItems: requestedOrder.length,
                totalMoves: moves.length,
            },
        });
        logAction(
            req,
            'accepted gallery reorder',
            `${folderPath}
            #galleryEdit.js #reorder`,
        );
    } catch (err) {
        console.error('reorder route error', err);
        if (statusKey) {
            try {
                await uploadToS3(
                    Buffer.from(
                        JSON.stringify({
                            status: 'error',
                            stage: 'failed-to-queue',
                            error: String(err),
                            at: new Date().toISOString(),
                        }),
                    ),
                    statusKey,
                    'application/json',
                );
            } catch (statusErr) {
                console.error(
                    'Failed to write reorder queue error status',
                    statusErr,
                );
            }
        }

        if (!res.headersSent) {
            sendError(res, {
                httpStatus: 500,
                message: 'Не удалось запустить перестановку фотографий',
            });
        }
    }
});

router.get('/reorder-status', async (req, res) => {
    try {
        const statusKey = sanitizeS3Key(req.query.statusKey || '');
        if (
            !statusKey ||
            !statusKey.startsWith(REORDER_STATUS_ROOT) ||
            !statusKey.endsWith('.json')
        ) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Некорректный statusKey',
            });
        }

        let payload = {};
        try {
            const raw = await getObjectBufferFromS3(statusKey);
            if (raw.length > 0) {
                payload = JSON.parse(raw.toString('utf8'));
            }
        } catch (err) {
            if (err?.code === 'NoSuchKey') {
                return sendError(res, {
                    httpStatus: 404,
                    status: 'warning',
                    message: 'Статус задачи не найден',
                });
            }
            throw err;
        }

        sendSuccess(res, {
            message: 'Статус задачи загружен',
            payload: {
                statusKey,
                job: payload,
            },
        });
    } catch (err) {
        console.error('reorder-status route error', err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось получить статус задачи',
        });
    }
});

router.get('/reconcile', async (req, res) => {
    try {
        const rawPrefix = String(
            req.query.prefix || req.body?.prefix || '',
        ).trim();
        const limit = Number(req.query.limit || req.body?.limit || 0) || 0;
        const parsedPrefix = parseCardPath(rawPrefix);

        if (!parsedPrefix) {
            logAction(
                req,
                'Prefix required',
                '#galleryEdit.js #reconcile #error',
            );
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message:
                    'Некорректный prefix. Используйте формат "year/category"',
            });
        }

        const prefix = parsedPrefix.path;
        await ensureCardExists(prefix);

        const jobId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const statusKey = `processing/reconcile/${prefix}/${jobId}.json`;

        await uploadToS3(
            Buffer.from(
                JSON.stringify({
                    status: 'queued',
                    startedAt: new Date().toISOString(),
                }),
            ),
            statusKey,
        );

        sendSuccess(res, {
            httpStatus: 202,
            status: 'accepted',
            message: 'Задача на восстановление принята',
            payload: { statusKey },
        });
        logAction(
            req,
            'accepted',
            `${statusKey}
            #galleryEdit.js #reconcile`,
        );

        setImmediate(async () => {
            try {
                const origPrefix = `${ORIGINAL_ROOT}${prefix}/`;
                const origList = await listObjects(origPrefix);
                const origFiles = (origList.Contents || []).filter(
                    (file) =>
                        file.Key && /\.(jpe?g|png|tiff?)$/i.test(file.Key),
                );

                if (origFiles.length === 0) {
                    await uploadToS3(
                        Buffer.from(
                            JSON.stringify({
                                status: 'done',
                                reason: 'no originals',
                                finishedAt: new Date().toISOString(),
                            }),
                        ),
                        statusKey,
                    );
                    logAction(
                        req,
                        'done',
                        'no originals #galleryEdit.js #reconcile',
                    );
                    return;
                }

                const existingKeys = new Set();

                try {
                    const previewList = await listObjects(
                        `${PREVIEW_ROOT}${prefix}/`,
                    );
                    (previewList.Contents || []).forEach(
                        (obj) => obj.Key && existingKeys.add(obj.Key),
                    );
                } catch (err) {
                    console.error('Failed to list preview objects:', err);
                }

                for (const dir of SCREEN_DIRS) {
                    try {
                        const list = await listObjects(`${dir}/${prefix}/`);
                        (list.Contents || []).forEach(
                            (obj) => obj.Key && existingKeys.add(obj.Key),
                        );
                    } catch (err) {
                        console.error(`Failed to list ${dir} objects:`, err);
                    }
                }

                const totalToCheck = origFiles.length;
                let processed = 0;
                let created = 0;
                const errors = [];

                await uploadToS3(
                    Buffer.from(
                        JSON.stringify({
                            status: 'running',
                            total: totalToCheck,
                            processed,
                            created,
                            startedAt: new Date().toISOString(),
                        }),
                    ),
                    statusKey,
                );

                const webpOptions = { quality: 85, effort: 6 };

                for (const fileObj of origFiles) {
                    if (limit > 0 && created >= limit) {
                        break;
                    }

                    const origKey = fileObj.Key;
                    if (!origKey) {
                        continue;
                    }

                    let rel = origKey.startsWith(ORIGINAL_ROOT)
                        ? origKey.slice(ORIGINAL_ROOT.length)
                        : origKey;
                    rel = rel.replace(/^\/+/, '');
                    const ext = path.posix.extname(rel);
                    const baseNoExt = ext ? rel.slice(0, -ext.length) : rel;

                    const expected = [
                        `${PREVIEW_ROOT}${baseNoExt}.webp`,
                        ...SCREEN_DIRS.map((dir) => `${dir}/${baseNoExt}.webp`),
                    ];
                    const missing = expected.filter(
                        (key) => !existingKeys.has(key),
                    );

                    if (missing.length === 0) {
                        processed += 1;
                        if (processed % 5 === 0) {
                            await uploadToS3(
                                Buffer.from(
                                    JSON.stringify({
                                        status: 'running',
                                        total: totalToCheck,
                                        processed,
                                        created,
                                    }),
                                ),
                                statusKey,
                            );
                        }
                        continue;
                    }

                    let origUrl;
                    try {
                        origUrl = await getSignedUrlForKey(origKey, 60);
                    } catch (err) {
                        errors.push({ key: origKey, error: String(err) });
                        processed += 1;
                        await uploadToS3(
                            Buffer.from(
                                JSON.stringify({
                                    status: 'running',
                                    total: totalToCheck,
                                    processed,
                                    created,
                                    errors,
                                }),
                            ),
                            statusKey,
                        );
                        continue;
                    }

                    let origBuffer;
                    try {
                        const response = await fetch(origUrl);
                        if (!response.ok) {
                            throw new Error(
                                `failed to fetch original ${response.status}`,
                            );
                        }
                        const arrBuffer = await response.arrayBuffer();
                        origBuffer = Buffer.from(arrBuffer);
                    } catch (err) {
                        errors.push({
                            key: origKey,
                            error: 'download failed: ' + String(err),
                        });
                        processed += 1;
                        await uploadToS3(
                            Buffer.from(
                                JSON.stringify({
                                    status: 'running',
                                    total: totalToCheck,
                                    processed,
                                    created,
                                    errors,
                                }),
                            ),
                            statusKey,
                        );
                        continue;
                    }

                    const sizes = [
                        { dir: PREVIEW_ROOT.replace(/\/$/, ''), width: 400 },
                        { dir: 'screen-1280', width: 1280 },
                        { dir: 'screen-1920', width: 1920 },
                        { dir: 'screen-2560', width: 2560 },
                    ];
                    const maxWidth = Math.max(
                        ...sizes.map((size) => size.width),
                    );

                    let baseBuffer;
                    try {
                        baseBuffer = await sharp(origBuffer)
                            .resize({
                                width: maxWidth,
                                withoutEnlargement: true,
                                fit: 'inside',
                            })
                            .toBuffer();
                    } catch (err) {
                        errors.push({
                            key: origKey,
                            error: 'sharp resize failed: ' + String(err),
                        });
                        processed += 1;
                        await uploadToS3(
                            Buffer.from(
                                JSON.stringify({
                                    status: 'running',
                                    total: totalToCheck,
                                    processed,
                                    created,
                                    errors,
                                }),
                            ),
                            statusKey,
                        );
                        continue;
                    }

                    for (const missKey of missing) {
                        try {
                            let targetWidth = 400;
                            if (missKey.startsWith('screen-1280/')) {
                                targetWidth = 1280;
                            } else if (missKey.startsWith('screen-1920/')) {
                                targetWidth = 1920;
                            } else if (missKey.startsWith('screen-2560/')) {
                                targetWidth = 2560;
                            }

                            const resizedBuffer =
                                targetWidth === maxWidth
                                    ? baseBuffer
                                    : await sharp(baseBuffer)
                                          .resize({
                                              width: targetWidth,
                                              withoutEnlargement: true,
                                              fit: 'inside',
                                          })
                                          .toBuffer();

                            const webpBuffer = await sharp(resizedBuffer)
                                .webp(webpOptions)
                                .toBuffer();

                            await uploadToS3(webpBuffer, missKey);
                            existingKeys.add(missKey);
                            created += 1;
                        } catch (err) {
                            errors.push({
                                key: missKey,
                                error: 'create/upload failed: ' + String(err),
                            });
                        }
                    }

                    processed += 1;
                    await uploadToS3(
                        Buffer.from(
                            JSON.stringify({
                                status: 'running',
                                total: totalToCheck,
                                processed,
                                created,
                                errors,
                            }),
                        ),
                        statusKey,
                    );
                }

                await uploadToS3(
                    Buffer.from(
                        JSON.stringify({
                            status: 'done',
                            total: totalToCheck,
                            processed,
                            created,
                            errors,
                            finishedAt: new Date().toISOString(),
                        }),
                    ),
                    statusKey,
                );

                try {
                    await syncCardByPath(prefix);
                } catch (syncErr) {
                    console.error(
                        'Failed to sync card after reconcile',
                        syncErr,
                    );
                }
            } catch (err) {
                console.error('Reconcile job failed:', err);
                try {
                    await uploadToS3(
                        Buffer.from(
                            JSON.stringify({
                                status: 'error',
                                error: String(err),
                                at: new Date().toISOString(),
                            }),
                        ),
                        statusKey,
                    );
                } catch (statusErr) {
                    console.error('Failed to write error status:', statusErr);
                }
            }
        });
    } catch (err) {
        console.error('reconcile route error:', err);
        if (!res.headersSent) {
            sendError(res, {
                httpStatus: 500,
                message: 'Внутренняя ошибка',
            });
        }
    }
});

router.use((err, req, res, next) => {
    if (
        !(err instanceof multer.MulterError) &&
        err?.message !== 'Unsupported file type'
    ) {
        return next(err);
    }

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return sendError(res, {
                httpStatus: 413,
                status: 'warning',
                message: `Файл слишком большой. Максимум ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
            });
        }
        return sendError(res, {
            httpStatus: 400,
            status: 'warning',
            message: err.message || 'Ошибка загрузки',
        });
    }

    return sendError(res, {
        httpStatus: 400,
        status: 'warning',
        message:
            'Неподдерживаемый тип файла. Разрешены JPEG/PNG/WEBP/AVIF/GIF/TIFF',
    });
});

export default router;
