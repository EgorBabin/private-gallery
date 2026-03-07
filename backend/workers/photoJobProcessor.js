import sharp from 'sharp';
import {
    uploadToS3,
    getObjectBufferFromS3,
    deleteFromS3,
} from '../utils/s3Client.js';
import { syncCardByPath } from '../utils/galleryCardSync.js';
import { processGalleryReorderJob } from './galleryReorderJobProcessor.js';
import { processGallerySoftDeleteJob } from './gallerySoftDeleteJobProcessor.js';

sharp.concurrency(1);
sharp.cache(false);

const PREVIEW_ROOT = 'preview/';
const SCREEN_SIZES = [
    { dir: 'preview', width: 400 },
    { dir: 'screen-1280', width: 1280 },
    { dir: 'screen-1920', width: 1920 },
    { dir: 'screen-2560', width: 2560 },
];
const VIDEO_DIRS = ['video_1440', 'video_1080', 'video_720'];
const WEBP_OPTIONS = { quality: 85, effort: 6 };
const SHARP_INPUT_OPTIONS = { failOn: 'truncated' };
const JOB_TYPE_UPLOAD = 'photo-upload';
const JOB_TYPE_REORDER = 'gallery-reorder';
const JOB_TYPE_SOFT_DELETE = 'gallery-soft-delete';

function normalizeUploadJob(rawPayload) {
    const payload =
        rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const folderPath = String(payload.folderPath || '').trim();
    const baseName = String(payload.baseName || '').trim();
    const sourceKey = String(payload.sourceKey || '').trim();
    const statusKey = String(payload.statusKey || '').trim();
    const originalKey = String(payload.originalKey || '').trim() || null;

    if (!folderPath) {
        throw new Error('Invalid queue payload: folderPath is required');
    }
    if (!baseName) {
        throw new Error('Invalid queue payload: baseName is required');
    }
    if (!sourceKey) {
        throw new Error('Invalid queue payload: sourceKey is required');
    }
    if (!statusKey) {
        throw new Error('Invalid queue payload: statusKey is required');
    }

    return {
        folderPath,
        baseName,
        sourceKey,
        statusKey,
        originalKey,
        videoFlag: Boolean(payload.videoFlag),
        cleanupSource: Boolean(payload.cleanupSource),
    };
}

async function writeStatus(statusKey, statusPayload) {
    await uploadToS3(
        Buffer.from(JSON.stringify(statusPayload)),
        statusKey,
        'application/json',
    );
}

async function safeWriteStatus(statusKey, statusPayload) {
    try {
        await writeStatus(statusKey, statusPayload);
    } catch (err) {
        console.error('Failed to write job status', statusKey, err);
    }
}

async function cleanupUploadedKeys(keys) {
    for (const key of keys) {
        try {
            await deleteFromS3(key);
        } catch (err) {
            console.error(
                'Failed to cleanup object after failed job',
                key,
                err,
            );
        }
    }
}

async function assertReadableImage(buffer, key) {
    try {
        await sharp(buffer, SHARP_INPUT_OPTIONS).metadata();
    } catch (err) {
        throw new Error(`Invalid image in S3 key "${key}": ${String(err)}`);
    }
}

async function buildImageOutputs(sourceBuffer, folderPath, baseName) {
    const maxWidth = Math.max(...SCREEN_SIZES.map((size) => size.width));
    const baseBuffer = await sharp(sourceBuffer, SHARP_INPUT_OPTIONS)
        .resize({
            width: maxWidth,
            withoutEnlargement: true,
            fit: 'inside',
        })
        .toBuffer();

    const outputs = [];
    for (const size of SCREEN_SIZES) {
        const outKey = `${size.dir}/${folderPath}/${baseName}.webp`;
        const resizedBuffer =
            size.width === maxWidth
                ? baseBuffer
                : await sharp(baseBuffer, SHARP_INPUT_OPTIONS)
                      .resize({
                          width: size.width,
                          withoutEnlargement: true,
                          fit: 'inside',
                      })
                      .toBuffer();
        const webpBuffer = await sharp(resizedBuffer, SHARP_INPUT_OPTIONS)
            .webp(WEBP_OPTIONS)
            .toBuffer();

        // Double-check produced binary is readable and not truncated.
        await sharp(webpBuffer, SHARP_INPUT_OPTIONS).metadata();
        outputs.push({ key: outKey, buffer: webpBuffer });
    }

    return outputs;
}

async function buildVideoOutputs(sourceBuffer, folderPath, baseName) {
    const previewWidth = 400;
    const baseBuffer = await sharp(sourceBuffer, SHARP_INPUT_OPTIONS)
        .resize({
            width: previewWidth,
            withoutEnlargement: true,
            fit: 'inside',
        })
        .toBuffer();
    const webpBuf = await sharp(baseBuffer, SHARP_INPUT_OPTIONS)
        .webp(WEBP_OPTIONS)
        .toBuffer();
    await sharp(webpBuf, SHARP_INPUT_OPTIONS).metadata();

    const previewKey = `${PREVIEW_ROOT}${folderPath}/${baseName}.webp`;
    const outputs = [{ key: previewKey, buffer: webpBuf }];
    for (const dir of VIDEO_DIRS) {
        outputs.push({
            key: `${dir}/${folderPath}/.placeholder`,
            buffer: Buffer.alloc(0),
        });
    }
    return outputs;
}

async function uploadOutputsAtomically(outputs) {
    const uploadedKeys = [];
    try {
        for (const output of outputs) {
            await uploadToS3(output.buffer, output.key);
            uploadedKeys.push(output.key);
        }
        return uploadedKeys;
    } catch (err) {
        await cleanupUploadedKeys(uploadedKeys);
        throw err;
    }
}

async function processUploadJob(rawPayload) {
    const job = normalizeUploadJob(rawPayload);
    const startedAt = new Date().toISOString();

    await safeWriteStatus(job.statusKey, {
        status: 'processing',
        startedAt,
    });

    let uploadedKeys = [];

    try {
        const sourceBuffer = await getObjectBufferFromS3(job.sourceKey);
        if (!sourceBuffer.length) {
            throw new Error(`Source file is empty: ${job.sourceKey}`);
        }

        await assertReadableImage(sourceBuffer, job.sourceKey);

        const outputs = job.videoFlag
            ? await buildVideoOutputs(
                  sourceBuffer,
                  job.folderPath,
                  job.baseName,
              )
            : await buildImageOutputs(
                  sourceBuffer,
                  job.folderPath,
                  job.baseName,
              );

        uploadedKeys = await uploadOutputsAtomically(outputs);

        await safeWriteStatus(job.statusKey, {
            status: 'done',
            finishedAt: new Date().toISOString(),
            keys: uploadedKeys,
        });

        const previewKey =
            uploadedKeys.find((key) => key.startsWith(PREVIEW_ROOT)) || null;
        try {
            await syncCardByPath(job.folderPath, previewKey);
        } catch (syncErr) {
            console.error(
                'Failed to sync card after image processing',
                syncErr,
            );
        }
    } catch (err) {
        await safeWriteStatus(job.statusKey, {
            status: 'error',
            error: String(err),
            at: new Date().toISOString(),
        });
        throw err;
    } finally {
        if (job.cleanupSource && job.sourceKey !== job.originalKey) {
            try {
                await deleteFromS3(job.sourceKey);
            } catch (cleanupErr) {
                console.error(
                    'Failed to cleanup temporary source object',
                    job.sourceKey,
                    cleanupErr,
                );
            }
        }
    }

    return { uploadedKeys };
}

export async function processPhotoJob(rawPayload) {
    const payload =
        rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const rawJobType = String(payload.jobType || JOB_TYPE_UPLOAD)
        .trim()
        .toLowerCase();

    if (rawJobType === JOB_TYPE_REORDER) {
        return processGalleryReorderJob(payload);
    }
    if (rawJobType === JOB_TYPE_SOFT_DELETE) {
        return processGallerySoftDeleteJob(payload);
    }

    return processUploadJob(payload);
}
