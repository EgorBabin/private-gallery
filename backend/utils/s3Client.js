import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.S3_BUCKET;
const forcePath = process.env.S3_FORCE_PATH_STYLE === 'true';

const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: forcePath,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    logger: console,
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

export async function getSignedUrlForKey(key, expiresInSec = 300) {
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
        if (e.Code === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
            const err = new Error('S3: access denied to object');
            err.code = 'AccessDenied';
            throw err;
        }
        throw e;
    }

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return awsGetSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

export async function uploadToS3(buffer, key, contentType = 'image/jpeg') {
    const cmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    });
    await s3.send(cmd);
}

export async function getLastImageNumber(prefix) {
    const cmd = new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
    });

    const data = await s3.send(cmd);

    if (!data.Contents?.length) {
        return 0;
    }

    const numbers = data.Contents.map((obj) => {
        const match = obj.Key.match(/(\d+)\.jpg$/);
        return match ? parseInt(match[1], 10) : 0;
    }).filter(Boolean);

    return numbers.length ? Math.max(...numbers) : 0;
}

export default s3;
