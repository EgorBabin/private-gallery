import express from 'express';
import {
    listPrefixes,
    listObjects,
    getSignedUrlForKey,
} from '../utils/s3Client.js';
import { parseIndexFromKey } from '../utils/filename.js';
import path from 'path';

const router = express.Router();

const PREVIEW_ROOT = 'preview/';
const ORIGINAL_ROOT = 'original_photo/';
const SCREEN_DIRS = ['screen-1280', 'screen-1920', 'screen-2560'];

// GET /api/gallery/cards
router.get('/cards', async (req, res) => {
    try {
        const years = await listPrefixes(PREVIEW_ROOT); // ['preview/2024/','preview/2023/']
        const cards = [];

        for (const yearPrefix of years) {
            const categories = await listPrefixes(yearPrefix);
            for (const catPrefix of categories) {
                const year = yearPrefix
                    .replace(PREVIEW_ROOT, '')
                    .replace(/\/$/, '');
                const category = catPrefix
                    .replace(yearPrefix, '')
                    .replace(/\/$/, '');
                const prefix = `${year}/${category}/`;

                const listResult = await listObjects(
                    `${PREVIEW_ROOT}${prefix}`,
                );
                const files = listResult.Contents || [];

                const imgFiles = files.filter(
                    (f) => f.Key && /\.(jpe?g|png|webp|avif|gif)$/i.test(f.Key),
                );

                const imageCount = imgFiles.length;

                let thumbnailUrl = null;
                if (imgFiles.length > 0) {
                    const sorted = imgFiles
                        .slice()
                        .sort((a, b) => a.Key.localeCompare(b.Key));
                    const thumbKey = sorted[0].Key; // полный ключ, например "preview/2024/event/abc.webp"
                    try {
                        thumbnailUrl = await getSignedUrlForKey(
                            thumbKey,
                            60 * 5,
                        );
                    } catch (e) {
                        console.error(
                            'Failed to get signed URL for thumbnail',
                            thumbKey,
                            e,
                        );
                        thumbnailUrl = null;
                    }
                }

                cards.push({
                    year,
                    category,
                    prefix,
                    thumbnailUrl,
                    imageCount,
                });
            }
        }

        res.json({ cards });
    } catch (err) {
        console.error('cards error', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/gallery/previews?prefix=year/category/&limit=100&continuationToken=...
router.get('/previews', async (req, res) => {
    try {
        const prefixParam = req.query.prefix;
        if (!prefixParam) {
            return res.status(400).json({ error: 'prefix query required' });
        }

        const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
        const continuationToken = req.query.continuationToken;

        const fullPrefix = PREVIEW_ROOT + prefixParam.replace(/^\/+/, '');
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
                console.debug(
                    'Skipping folder placeholder object from S3:',
                    obj.Key,
                );
                return false;
            }
            if (obj.Key.endsWith('/')) {
                console.debug('Skipping directory-like key from S3:', obj.Key);
                return false;
            }
            return true;
        });

        // преобразуем в объекты с индексом и url (вызываем signed url только для реальных файлов)
        const items = await Promise.all(
            fileContents.map(async (obj) => {
                const idx = parseIndexFromKey(obj.Key) ?? 0;

                const baseWithExt = path.posix.basename(obj.Key); // e.g. "video_12345.webp" or "12345.webp"
                const ext = path.posix.extname(baseWithExt);
                const rawBase = ext
                    ? baseWithExt.slice(0, -ext.length)
                    : baseWithExt;
                const isVideo = rawBase.startsWith('video_');
                const name = isVideo ? rawBase.replace(/^video_/, '') : rawBase;

                const url = await getSignedUrlForKey(obj.Key, 60 * 5);
                return {
                    key: obj.Key,
                    url,
                    index: idx,
                    size: obj.Size,
                    lastModified: obj.LastModified,
                    isVideo, // video preview
                    name,
                };
            }),
        );

        items.sort((a, b) => a.index - b.index);

        res.json({
            items,
            isTruncated: !!data.IsTruncated,
            nextContinuationToken: data.NextContinuationToken || null,
        });
    } catch (err) {
        console.error('previews error', err);
        res.status(500).json({ error: err.message });
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

        const ext = path.posix.extname(relative);
        const baseNoExt = ext ? relative.slice(0, -ext.length) : relative;

        const baseNameOnly = path.posix.basename(baseNoExt); // e.g. "video_12345" or "12345"
        const isVideo = baseNameOnly.startsWith('video_');

        const originalExt = ext || '.jpg';
        const originalKey = `${ORIGINAL_ROOT}${baseNoExt}${originalExt}`;

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

            return res.json({
                isVideo: true,
                preview: { key: previewKey, url: previewUrl },
                videos,
            });
        }

        const allKeys = [originalKey, previewKey, ...screenKeys];

        const urlPromises = allKeys.map((k) =>
            getSignedUrlForKey(k, 60 * 3).catch((e) => {
                console.error('getSignedUrlForKey failed for', k, e);
                return null;
            }),
        );

        const urls = await Promise.all(urlPromises);

        res.json({
            original: { key: originalKey, url: urls[0] },
            preview: { key: previewKey, url: urls[1] },
            screen1280: { key: screenKeys[0], url: urls[2] },
            screen1920: { key: screenKeys[1], url: urls[3] },
            screen2560: { key: screenKeys[2], url: urls[4] },
        });
    } catch (err) {
        console.error('original error', err);
        res.status(500).json({ error: err.message || 'Internal error' });
    }
});

export default router;
