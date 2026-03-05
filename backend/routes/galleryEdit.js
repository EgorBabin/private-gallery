import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import {
    uploadToS3,
    listObjects,
    getSignedUrlForKey,
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
import { publishPhotoJob } from '../utils/rabbitmq.js';
import { logAction } from '../utils/logger.js';

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
const PROCESSING_SOURCE_ROOT = 'processing/source/';
const CARDS_S3_CONCURRENCY = 4;

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

        res.json({ cards });
        logAction(req, 'Get cards-admin', '#galleryEdit.js #cards-admin');
    } catch (err) {
        console.error('cards-admin error', err);
        res.status(500).json({ error: 'Failed to fetch cards' });
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
            return res.status(400).json({
                error: 'Некорректный path. Используйте формат "year/category"',
            });
        }

        const title = String(body.title ?? parsedPath.category).trim();
        if (!title) {
            return res
                .status(400)
                .json({ error: 'Название карточки обязательно' });
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

        res.status(201).json({
            card: toCardResponse(synced, { thumbnailUrl }),
        });
        logAction(
            req,
            'Created card',
            `${synced.path}
            #galleryEdit.js #cards-admin #create`,
        );
    } catch (err) {
        if (err?.code === '23505') {
            return res
                .status(409)
                .json({ error: 'Карточка с таким path уже есть' });
        }
        if (isValidationError(err)) {
            return res.status(400).json({ error: err.message });
        }
        console.error('create card error', err);
        res.status(500).json({ error: 'Failed to create card' });
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
                return res.status(400).json({
                    error: 'Некорректный path. Используйте формат "year/category"',
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
            return res.status(404).json({ error: 'Card not found' });
        }

        const synced = await syncCardByPath(updated.path, patch.previewKey);
        const thumbnailUrl = await signPreviewUrl(synced.previewKey);

        res.json({ card: toCardResponse(synced, { thumbnailUrl }) });
        logAction(
            req,
            'Updated card',
            `${synced.path}
            #galleryEdit.js #cards-admin #update`,
        );
    } catch (err) {
        if (err?.code === '23505') {
            return res
                .status(409)
                .json({ error: 'Карточка с таким path уже есть' });
        }
        if (isValidationError(err)) {
            return res.status(400).json({ error: err.message });
        }
        console.error('update card error', err);
        res.status(500).json({ error: 'Failed to update card' });
    }
});

router.delete('/cards-admin/:id', async (req, res) => {
    try {
        const deleted = await deleteCard(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Card not found' });
        }
        res.json({ card: toCardResponse(deleted) });
        logAction(
            req,
            'Deleted card',
            `${deleted.path}
            #galleryEdit.js #cards-admin #delete`,
        );
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(400).json({ error: err.message });
        }
        console.error('delete card error', err);
        res.status(500).json({ error: 'Failed to delete card' });
    }
});

router.post('/upload', upload.single('image'), async (req, res) => {
    let statusKey = null;
    try {
        const parsedFolderPath = parseCardPath(req.body.path);
        if (!parsedFolderPath) {
            logAction(req, 'Missing path', '#galleryEdit.js #upload #error');
            return res.status(400).json({
                error: 'Некорректный path. Используйте формат "year/category"',
            });
        }

        const folderPath = parsedFolderPath.path;

        if (!req.file) {
            logAction(
                req,
                'No file uploaded',
                '#galleryEdit.js #upload #error',
            );
            return res.status(400).json({ error: 'No file uploaded' });
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

        await publishPhotoJob({
            folderPath,
            baseName,
            sourceKey,
            originalKey: videoFlag ? null : originalKey,
            statusKey,
            videoFlag,
            cleanupSource: videoFlag,
        });

        res.status(202).json({
            success: true,
            filename: baseName,
            statusKey,
        });
        logAction(
            req,
            'Uploaded new file',
            `${baseName}
            #galleryEdit.js #upload`,
        );
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
            res.status(500).json({ error: 'Upload failed' });
            logAction(
                req,
                'Upload failed',
                `${err}
                #galleryEdit.js #upload #error`,
            );
        }
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
            return res.status(400).json({
                error: 'Некорректный prefix. Используйте формат "year/category"',
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

        res.status(202).json({ status: 'accepted', statusKey });
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
            res.status(500).json({ error: 'Internal error' });
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
            return res.status(413).json({
                error: `Файл слишком большой. Максимум ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
            });
        }
        return res.status(400).json({ error: err.message || 'Upload error' });
    }

    return res.status(400).json({
        error: 'Неподдерживаемый тип файла. Разрешены JPEG/PNG/WEBP/AVIF/GIF/TIFF',
    });
});

export default router;
