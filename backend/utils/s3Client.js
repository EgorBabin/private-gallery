import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';

const BUCKET = process.env.S3_BUCKET;
const forcePath = process.env.S3_FORCE_PATH_STYLE === 'true';
const IS_DEBUG_LOGS = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: forcePath,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    ...(IS_DEBUG_LOGS ? { logger: console } : {}),
});

export async function listObjects(prefix, maxKeys = 1000, continuationToken) {
    try {
        const cmd = new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            MaxKeys: maxKeys,
            ContinuationToken: continuationToken,
        });
        return await s3.send(cmd);
    } catch (e) {
        console.error('listObjects ERROR', {
            code: e.Code || e.name,
            status: e.$metadata?.httpStatusCode,
            prefix,
        });
        if (e.Code === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
            const err = new Error(
                `S3 AccessDenied for ListObjects on bucket "${BUCKET}" and prefix "${prefix}"`,
            );
            err.code = 'AccessDenied';
            throw err;
        }
        throw e;
    }
}

export async function listPrefixes(prefix = '') {
    const cmd = new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: 1000,
    });
    try {
        const data = await s3.send(cmd);
        return (data.CommonPrefixes || []).map((p) => p.Prefix);
    } catch (e) {
        console.error('listPrefixes ERROR', {
            code: e.Code || e.name,
            status: e.$metadata?.httpStatusCode,
            prefix,
        });
        if (e.Code === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
            return [];
        }
        if (e.Code === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
            throw new Error(
                `S3 AccessDenied: check bucket IAM/policy for bucket "${BUCKET}"`,
            );
        }
        throw e;
    }
}

export async function getSignedUrlForKey(key, expiresInSec = 300, opts = {}) {
    const { skipHead = false } = opts;

    if (!skipHead) {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        } catch (e) {
            console.error('HeadObject failed for', key, {
                code: e.Code || e.name,
                status: e.$metadata?.httpStatusCode,
            });
            if (
                e.Code === 'NotFound' ||
                e.Code === 'NoSuchKey' ||
                e.$metadata?.httpStatusCode === 404
            ) {
                const err = new Error('S3: object not found');
                err.code = 'NoSuchKey';
                throw err;
            }
            if (
                e.Code === 'AccessDenied' ||
                e.$metadata?.httpStatusCode === 403
            ) {
                const err = new Error('S3: access denied to object');
                err.code = 'AccessDenied';
                throw err;
            }
            throw e;
        }
    }

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return awsGetSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

const CONTENT_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.json': 'application/json',
};

export async function uploadToS3(buffer, key, contentType) {
    let ct = contentType;
    if (!ct) {
        const ext = path.extname(key).toLowerCase();
        ct = CONTENT_TYPES[ext] || 'application/octet-stream';
    }

    const cmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: ct,
    });

    return s3.send(cmd);
}

export async function getObjectBufferFromS3(key) {
    const cmd = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });
    const data = await s3.send(cmd);
    if (!data?.Body) {
        return Buffer.alloc(0);
    }

    if (typeof data.Body.transformToByteArray === 'function') {
        const bytes = await data.Body.transformToByteArray();
        return Buffer.from(bytes);
    }

    const chunks = [];
    for await (const chunk of data.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function deleteFromS3(key) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
        return;
    }

    const cmd = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: cleanKey,
    });
    await s3.send(cmd);
}

export default s3;
