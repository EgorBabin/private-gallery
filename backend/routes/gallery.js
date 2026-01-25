import express from 'express';
import {
    listPrefixes,
    listObjects,
    getSignedUrlForKey,
} from '../utils/s3Client.js';
import { parseIndexFromKey } from '../utils/filename.js';

const router = express.Router();

const PREVIEW_ROOT = 'preview/';
const ORIGINAL_ROOT = 'original_photo/';

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

                const firstKey = `${PREVIEW_ROOT}${prefix}1.jpg`;
                let thumbnailUrl = null;
                if (firstKey) {
                    thumbnailUrl = await getSignedUrlForKey(firstKey, 60 * 5);
                }

                const listResult = await listObjects(
                    `${PREVIEW_ROOT}${prefix}`,
                );
                const files = listResult.Contents || [];
                const imageCount = files.filter(
                    (f) => f.Key && f.Key.endsWith('.jpg'),
                ).length;

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
        //  - ключ точный равен префиксу (с/без слэша) — это placeholder папки
        //  - или ключ заканчивается на '/' — тоже явно папка
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
