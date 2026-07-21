import { listPrefixes, listObjects } from '../utils/s3Client.js';
import { setPreviewCache } from '../utils/s3Cache.js';

const PREVIEW_ROOT = 'preview/';
const DEFAULT_INTERVAL_MS = Number(process.env.GALLERY_CACHE_REFRESH_MS || 1000 * 60 * 5); // 5 min

export function startGalleryCacheRefresher() {
    let timer = null;
    let stopped = false;

    async function runOnce() {
        try {
            // list year-level prefixes under preview/
            const years = await listPrefixes(PREVIEW_ROOT);
            for (const yearPrefix of years || []) {
                // yearPrefix like 'preview/2024/'
                const year = String(yearPrefix || '').replace(/^preview\/+|\/+$/g, '');
                if (!year) continue;
                const categories = await listPrefixes(`${PREVIEW_ROOT}${year}/`);
                for (const catPrefix of categories || []) {
                    const rel = String(catPrefix || '')
                        .replace(/^preview\/+/, '')
                        .replace(/\/+$/, '');
                    if (!rel) continue;
                    // collect objects for this prefix
                    const fullPrefix = `${PREVIEW_ROOT}${rel}/`;
                    let continuation = null;
                    const discovered = [];
                    do {
                        const page = await listObjects(fullPrefix, 1000, continuation);
                        const contents = page.Contents || [];
                        for (const obj of contents) {
                            if (!obj || !obj.Key) continue;
                            if (obj.Key.endsWith('/')) continue;
                            discovered.push({ key: obj.Key, size: Number(obj.Size) || 0, lastModified: obj.LastModified ? new Date(obj.LastModified).toISOString() : null });
                        }
                        continuation = page.IsTruncated ? page.NextContinuationToken || null : null;
                    } while (continuation);

                    try {
                        await setPreviewCache(rel, discovered);
                    } catch (err) {
                        void err;
                    }
                }
            }
        } catch (err) {
            console.error('Gallery cache refresher error', err);
        }
    }

    async function start() {
        // run immediately
        await runOnce();
        if (stopped) return;
        timer = setInterval(() => void runOnce(), DEFAULT_INTERVAL_MS);
    }

    start().catch((err) => console.error('Failed to start gallery cache refresher', err));

    return async function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
    };
}

export default startGalleryCacheRefresher;
