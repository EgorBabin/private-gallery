import sharp from 'sharp';
import { listPrefixes, getObjectBufferFromS3 } from '../utils/s3Client.js';
import { setPreviewCache } from '../utils/s3Cache.js';
import { listFolderPreviewsFromS3 } from '../utils/folderListing.js';
import {
    getDimensionsByEtags,
    saveDimensions,
} from '../utils/mediaDimensions.js';

const PREVIEW_ROOT = 'preview/';
const IMAGE_FILE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
// Кэш сбрасывается при каждом изменении папки (syncCardByPath), поэтому
// периодическое обновление нужно только для правок в S3 мимо приложения.
const DEFAULT_INTERVAL_MS = Number(
    process.env.GALLERY_CACHE_REFRESH_MS || 1000 * 60 * 60,
); // 1h
// Сколько старых preview без сохранённых размеров дозаполнять за один проход.
const DIMENSIONS_BACKFILL_PER_RUN = 500;

async function backfillDimensions(items, budget) {
    const candidates = items.filter(
        (item) => item.etag && IMAGE_FILE_RE.test(item.key),
    );
    if (budget <= 0 || candidates.length === 0) {
        return 0;
    }

    const known = await getDimensionsByEtags(
        candidates.map((item) => item.etag),
    );
    let processed = 0;
    for (const item of candidates) {
        if (processed >= budget) {
            break;
        }
        if (known.has(item.etag)) {
            continue;
        }
        processed += 1;
        try {
            const buffer = await getObjectBufferFromS3(item.key);
            const meta = await sharp(buffer).metadata();
            await saveDimensions(item.etag, meta.width, meta.height);
            known.set(item.etag, true);
        } catch (err) {
            console.error(
                'Failed to backfill dimensions for',
                item.key,
                err.message,
            );
        }
    }
    return processed;
}

export function startGalleryCacheRefresher() {
    let timer = null;
    let stopped = false;

    let running = false;

    async function runOnce() {
        if (running) {
            return;
        }
        running = true;
        let backfillBudget = DIMENSIONS_BACKFILL_PER_RUN;
        try {
            // list year-level prefixes under preview/
            const years = await listPrefixes(PREVIEW_ROOT);
            for (const yearPrefix of years || []) {
                if (stopped) {
                    return;
                }
                // yearPrefix like 'preview/2024/'
                const year = String(yearPrefix || '').replace(
                    /^preview\/+|\/+$/g,
                    '',
                );
                if (!year) {
                    continue;
                }
                const categories = await listPrefixes(
                    `${PREVIEW_ROOT}${year}/`,
                );
                for (const catPrefix of categories || []) {
                    if (stopped) {
                        return;
                    }
                    const rel = String(catPrefix || '')
                        .replace(/^preview\/+/, '')
                        .replace(/\/+$/, '');
                    if (!rel) {
                        continue;
                    }

                    const discovered = await listFolderPreviewsFromS3(rel);
                    await setPreviewCache(rel, discovered);

                    try {
                        backfillBudget -= await backfillDimensions(
                            discovered,
                            backfillBudget,
                        );
                    } catch (err) {
                        console.error(
                            'Dimensions backfill error',
                            rel,
                            err.message,
                        );
                    }
                }
            }
        } catch (err) {
            console.error('Gallery cache refresher error', err);
        } finally {
            running = false;
        }
    }

    async function start() {
        // run immediately
        await runOnce();
        if (stopped) {
            return;
        }
        timer = setInterval(() => void runOnce(), DEFAULT_INTERVAL_MS);
    }

    start().catch((err) =>
        console.error('Failed to start gallery cache refresher', err),
    );

    return async function stop() {
        stopped = true;
        if (timer) {
            clearInterval(timer);
        }
    };
}

export default startGalleryCacheRefresher;
