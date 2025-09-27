import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.S3_BUCKET;

const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
});

export async function listObjects(prefix, maxKeys = 1000, continuationToken) {
    const cmd = new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
    });
    return s3.send(cmd);
}

export async function listPrefixes(prefix = '') {
    const cmd = new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: 1000,
    });
    const data = await s3.send(cmd);
    return (data.CommonPrefixes || []).map((p) => p.Prefix);
}

export async function getSignedUrlForKey(key, expiresInSec = 300) {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return awsGetSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

export default s3;
