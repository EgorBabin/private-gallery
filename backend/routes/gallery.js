import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    listPrefixes,
    listObjects,
    getSignedUrlForKey,
} from '../utils/s3Client.js';
import { parseIndexFromKey } from '../utils/filename.js';

const router = express.Router();

const PREVIEW_ROOT = 'preview/';
const ORIGINAL_ROOT = 'original_photo/';

const galleryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
});
router.use(galleryLimiter);

// GET /api/gallery/cards
router.get('/cards', async (req, res) => {
    try {
        const years = await listPrefixes(PREVIEW_ROOT); // ['preview/2024/','preview/2023/']
        const cards = [];

        for (const yearPrefix of years) {
            const categories = await listPrefixes(yearPrefix);
            for (const catPrefix of categories) {
                // получаем первый файл в превью префиксе
                const list = await listObjects(catPrefix, 1);
                const firstKey =
                    list.Contents && list.Contents[0] && list.Contents[0].Key;
                let thumbnailUrl = null;
                if (firstKey) {
                    thumbnailUrl = await getSignedUrlForKey(firstKey, 60 * 5);
                }

                const year = yearPrefix
                    .replace(PREVIEW_ROOT, '')
                    .replace(/\/$/, '');
                const category = catPrefix
                    .replace(yearPrefix, '')
                    .replace(/\/$/, '');
                // prefix для фронта: "2024/trips/"
                const prefix = `${year}/${category}/`;
                cards.push({ year, category, prefix, thumbnailUrl });
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

        // преобразуем в объекты с индексом и url
        const items = await Promise.all(
            contents.map(async (obj) => {
                const idx = parseIndexFromKey(obj.Key) ?? 0;
                const url = await getSignedUrlForKey(obj.Key, 60 * 5);
                return {
                    key: obj.Key,
                    url,
                    index: idx,
                    size: obj.Size,
                    lastModified: obj.LastModified,
                };
            }),
        );

        // сортируем по numeric index (в рамках возвращённой пачки)
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

        // sanitize
        key = key.replace(/^\/+/, '').replace(/\.\./g, '');

        let fullKey = key.startsWith(ORIGINAL_ROOT) ? key : ORIGINAL_ROOT + key;
        // security: ensure starts with ORIGINAL_ROOT
        if (!fullKey.startsWith(ORIGINAL_ROOT)) {
            return res.status(400).json({ error: 'invalid key' });
        }

        const url = await getSignedUrlForKey(fullKey, 60 * 3);
        res.json({ url });
    } catch (err) {
        console.error('original error', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
