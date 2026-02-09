import os from 'os';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import {
    uploadToS3,
    listObjects,
    getSignedUrlForKey,
} from '../utils/s3Client.js';
import { logAction } from '../utils/logger.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

sharp.concurrency(1);
sharp.cache(false);

const CONCURRENT_BG_JOBS = 1;
if (!global._bgQueue) {
    global._bgQueue = {
        running: 0,
        queue: [],
        push(task) {
            return new Promise((resolve, reject) => {
                this.queue.push({ task, resolve, reject });
                this._next();
            });
        },
        async _next() {
            if (this.running >= CONCURRENT_BG_JOBS) {
                return;
            }
            const job = this.queue.shift();
            if (!job) {
                return;
            }
            this.running++;
            try {
                const result = await job.task();
                job.resolve(result);
            } catch (err) {
                job.reject(err);
            } finally {
                this.running--;
                setImmediate(() => this._next());
            }
        },
    };
}

function makeNumericName(req) {
    const now = BigInt(Date.now());
    if (!req.app.locals._uploadSeq) {
        req.app.locals._uploadSeq = 0n;
    }
    req.app.locals._uploadSeq = (req.app.locals._uploadSeq + 1n) % 1000n;
    return String(now * 1000n + req.app.locals._uploadSeq);
}

router.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const folderPath = req.body.path;
        if (!folderPath) {
            logAction(
                req,
                'Missing path',
                `${error}
                #galleryEdit.js #upload #error`,
            );
            return res.status(400).json({ error: 'Missing path' });
        }
        if (!req.file) {
            logAction(
                req,
                'No file uploaded',
                `${error}
                #galleryEdit.js #upload #error`,
            );
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const isVideo = String(req.body.video || '').toLowerCase();
        const videoFlag = isVideo === 'true';

        const buffer = req.file.buffer;
        let baseName = makeNumericName(req);
        if (videoFlag) {
            baseName = `video_${baseName}`;
        }

        const origExt = path.extname(req.file.originalname) || '.jpg';
        const originalKey = `original_photo/${folderPath}/${baseName}${origExt}`;
        const statusKey = `processing/${folderPath}/${baseName}.json`;

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
        try {
            res.flushHeaders?.();
        } catch (e) {
            /* ignore */
        }

        setImmediate(() => {
            global._bgQueue
                .push(async () => {
                    try {
                        if (!videoFlag) {
                            await uploadToS3(buffer, originalKey);
                        }

                        await uploadToS3(
                            Buffer.from(
                                JSON.stringify({
                                    status: 'processing',
                                    startedAt: new Date().toISOString(),
                                }),
                            ),
                            statusKey,
                        );

                        const webpOptions = { quality: 85, effort: 6 };

                        if (videoFlag) {
                            const previewDir = 'preview';
                            const previewWidth = 400;
                            const baseBuffer = await sharp(buffer)
                                .resize({
                                    width: previewWidth,
                                    withoutEnlargement: true,
                                    fit: 'inside',
                                })
                                .toBuffer();

                            const webpBuf = await sharp(baseBuffer)
                                .webp(webpOptions)
                                .toBuffer();

                            const previewKey = `${previewDir}/${folderPath}/${baseName}.webp`;
                            await uploadToS3(webpBuf, previewKey);

                            const VIDEO_DIRS = [
                                'video_1440',
                                'video_1080',
                                'video_720',
                            ];
                            const placeholder = Buffer.from('');
                            const createdKeys = [previewKey];
                            for (const d of VIDEO_DIRS) {
                                const placeholderKey = `${d}/${folderPath}/.placeholder`;
                                await uploadToS3(placeholder, placeholderKey);
                                createdKeys.push(placeholderKey);
                            }

                            await uploadToS3(
                                Buffer.from(
                                    JSON.stringify({
                                        status: 'done',
                                        finishedAt: new Date().toISOString(),
                                        keys: createdKeys,
                                    }),
                                ),
                                statusKey,
                            );
                        } else {
                            const sizes = [
                                { dir: 'preview', width: 400 },
                                { dir: 'screen-1280', width: 1280 },
                                { dir: 'screen-1920', width: 1920 },
                                { dir: 'screen-2560', width: 2560 },
                            ];

                            const maxWidth = Math.max(
                                ...sizes.map((s) => s.width),
                            );
                            const baseBuffer = await sharp(buffer)
                                .resize({
                                    width: maxWidth,
                                    withoutEnlargement: true,
                                    fit: 'inside',
                                })
                                .toBuffer();

                            const uploadedKeys = [];
                            for (const s of sizes) {
                                const outKey = `${s.dir}/${folderPath}/${baseName}.webp`;

                                const resized =
                                    s.width === maxWidth
                                        ? baseBuffer
                                        : await sharp(baseBuffer)
                                              .resize({
                                                  width: s.width,
                                                  withoutEnlargement: true,
                                                  fit: 'inside',
                                              })
                                              .toBuffer();

                                const webpBuf = await sharp(resized)
                                    .webp(webpOptions)
                                    .toBuffer();
                                await uploadToS3(webpBuf, outKey);
                                uploadedKeys.push(outKey);
                            }

                            await uploadToS3(
                                Buffer.from(
                                    JSON.stringify({
                                        status: 'done',
                                        finishedAt: new Date().toISOString(),
                                        keys: uploadedKeys,
                                    }),
                                ),
                                statusKey,
                            );
                            logAction(
                                req,
                                'Uploaded file done',
                                `${uploadedKeys}
                                #galleryEdit.js #upload`,
                            );
                        }
                    } catch (err) {
                        console.error('Background processing failed:', err);
                        logAction(
                            req,
                            'Background processing failed',
                            `${err}
                            #galleryEdit.js #upload #error`,
                        );
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
                        } catch (e) {
                            console.error('Failed to write error status:', e);
                            logAction(
                                req,
                                'Failed to write error status:',
                                `${e}
                                #galleryEdit.js #upload #error`,
                            );
                        }
                        throw err;
                    }
                })
                .catch((err) => {
                    console.error('Queue push failed:', err);
                    logAction(
                        req,
                        'Queue push failed',
                        `${err}
                        #galleryEdit.js #upload #error`,
                    );
                });
        });

        return;
    } catch (err) {
        console.error('Upload route error:', err);
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
        let prefix = (req.query.prefix || req.body?.prefix || '').trim();
        const limit = Number(req.query.limit || req.body?.limit || 0) || 0; // 0 = no limit

        if (!prefix) {
            logAction(
                req,
                'Prefix required',
                `${error}
                #galleryEdit.js #reconcile #error`,
            );
            return res.status(400).json({ error: 'prefix required' });
        }

        prefix = prefix.replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');

        const ORIGINAL_ROOT = 'original_photo/';
        const PREVIEW_ROOT = 'preview/';
        const SCREEN_DIRS = ['screen-1280', 'screen-1920', 'screen-2560'];

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
                    (f) => f.Key && /\.(jpe?g|png|tiff?)$/i.test(f.Key),
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
                        (o) => o.Key && existingKeys.add(o.Key),
                    );
                } catch (e) {
                    console.error('Failed to list preview objects:', e);
                }

                for (const dir of SCREEN_DIRS) {
                    try {
                        const r = await listObjects(`${dir}/${prefix}/`);
                        (r.Contents || []).forEach(
                            (o) => o.Key && existingKeys.add(o.Key),
                        );
                    } catch (e) {
                        console.error(`Failed to list ${dir} objects:`, e);
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

                    const origKey = fileObj.Key; // e.g. "original_photo/2024/event/abc123.jpg"
                    if (!origKey) {
                        continue;
                    }

                    let rel = origKey.startsWith(ORIGINAL_ROOT)
                        ? origKey.slice(ORIGINAL_ROOT.length)
                        : origKey;
                    rel = rel.replace(/^\/+/, '');
                    const ext = path.posix.extname(rel);
                    const baseNoExt = ext ? rel.slice(0, -ext.length) : rel; // "2024/event/abc123"

                    const expected = [
                        `${PREVIEW_ROOT}${baseNoExt}.webp`,
                        ...SCREEN_DIRS.map((d) => `${d}/${baseNoExt}.webp`),
                    ];

                    const missing = expected.filter(
                        (k) => !existingKeys.has(k),
                    );

                    if (missing.length === 0) {
                        processed++;
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
                    } catch (e) {
                        errors.push({ key: origKey, error: String(e) });
                        processed++;
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
                        const r = await fetch(origUrl);
                        if (!r.ok) {
                            throw new Error(
                                `failed to fetch original ${r.status}`,
                            );
                        }
                        const ab = await r.arrayBuffer();
                        origBuffer = Buffer.from(ab);
                    } catch (e) {
                        errors.push({
                            key: origKey,
                            error: 'download failed: ' + String(e),
                        });
                        processed++;
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
                    const maxW = Math.max(...sizes.map((s) => s.width));

                    let baseBuf;
                    try {
                        baseBuf = await sharp(origBuffer)
                            .resize({
                                width: maxW,
                                withoutEnlargement: true,
                                fit: 'inside',
                            })
                            .toBuffer();
                    } catch (e) {
                        errors.push({
                            key: origKey,
                            error: 'sharp resize failed: ' + String(e),
                        });
                        processed++;
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

                            const resizedBuf =
                                targetWidth === maxW
                                    ? baseBuf
                                    : await sharp(baseBuf)
                                          .resize({
                                              width: targetWidth,
                                              withoutEnlargement: true,
                                              fit: 'inside',
                                          })
                                          .toBuffer();

                            const webpBuf = await sharp(resizedBuf)
                                .webp(webpOptions)
                                .toBuffer();

                            await uploadToS3(webpBuf, missKey);
                            existingKeys.add(missKey);
                            created++;
                        } catch (e) {
                            errors.push({
                                key: missKey,
                                error: 'create/upload failed: ' + String(e),
                            });
                        }
                    }

                    processed++;
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
                } catch (e) {
                    console.error('Failed to write error status:', e);
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

export default router;
