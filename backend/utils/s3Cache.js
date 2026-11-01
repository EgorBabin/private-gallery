import { getRedisClient } from './redisClient.js';

const PREVIEW_KEY_PREFIX = 'gallery:preview:'; // gallery:preview:2024/event
const MEDIA_KEY_PREFIX = 'gallery:media:'; // gallery:media:2024/event -> hash base -> json
const MEDIA_BUILT_FIELD = '__built';
const DEFAULT_TTL_SEC = Number(process.env.REDIS_CACHE_TTL_SEC || 24 * 60 * 60); // 24h
const IS_DEBUG_LOGS = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

// Пока Redis недоступен, держим короткий кэш в памяти процесса: другой процесс
// (worker) не может его сбросить, поэтому TTL маленький.
const MEMORY_TTL_MS = 60 * 1000;
const MEMORY_MAX_ENTRIES = 500;
const memoryCache = new Map();

function memoryGet(key) {
    const entry = memoryCache.get(key);
    if (!entry) {
        return null;
    }
    if (entry.expiresAt < Date.now()) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
}

function memorySet(key, value) {
    if (memoryCache.size >= MEMORY_MAX_ENTRIES) {
        memoryCache.clear();
    }
    memoryCache.set(key, { value, expiresAt: Date.now() + MEMORY_TTL_MS });
}

function normalizePrefix(prefix) {
    return String(prefix || '').replace(/^\/+|\/+$/g, '');
}

function cacheKeyForPrefix(prefix) {
    // prefix expected like '2024/event' (no leading/trailing slash)
    return `${PREVIEW_KEY_PREFIX}${normalizePrefix(prefix)}`;
}

function mediaKeyForPrefix(prefix) {
    return `${MEDIA_KEY_PREFIX}${normalizePrefix(prefix)}`;
}

function debug(...args) {
    if (IS_DEBUG_LOGS) {
        console.debug(...args);
    }
}

export async function getPreviewCache(prefix) {
    const key = cacheKeyForPrefix(prefix);
    const client = getRedisClient();
    if (!client) {
        return memoryGet(key);
    }
    try {
        const raw = await client.get(key);
        if (!raw) {
            return null;
        }
        debug(`[Redis] Cache hit for ${prefix}`);
        return JSON.parse(raw);
    } catch (err) {
        debug(`[Redis] Cache read failed for ${prefix}:`, err.message);
        return memoryGet(key);
    }
}

export async function setPreviewCache(prefix, items) {
    const key = cacheKeyForPrefix(prefix);
    const list = items || [];
    // память процесса только как запасной вариант, пока Redis недоступен:
    // иначе в ней копились бы листинги всех папок
    const client = getRedisClient();
    if (!client) {
        memorySet(key, list);
        return;
    }
    try {
        await client.set(key, JSON.stringify(list), 'EX', DEFAULT_TTL_SEC);
        memoryCache.delete(key);
        debug(`[Redis] Cache set for ${prefix} (${list.length} items)`);
    } catch (err) {
        debug(`[Redis] Cache write failed for ${prefix}:`, err.message);
        memorySet(key, list);
    }
}

export async function addPreviewKey(prefix, item) {
    // item: { key, size?, lastModified?, etag? }
    const list = (await getPreviewCache(prefix)) || [];
    if (!list.find((i) => i.key === item.key)) {
        list.push(item);
        await setPreviewCache(prefix, list);
    }
}

export async function clearPreviewCache(prefix) {
    memoryCache.delete(cacheKeyForPrefix(prefix));
    const client = getRedisClient();
    if (!client) {
        return;
    }
    try {
        await client.del(cacheKeyForPrefix(prefix));
        debug(`[Redis] Cache cleared for ${prefix}`);
    } catch (err) {
        debug(`[Redis] Cache clear failed for ${prefix}:`, err.message);
    }
}

// --- Индекс медиа папки: какие оригиналы/размеры/видео существуют ---
// Позволяет /original отдавать ссылки без единого запроса к S3.

/**
 * @returns {Promise<{built: boolean, entry: object|null}>}
 */
export async function getMediaIndexEntry(prefix, base) {
    const key = mediaKeyForPrefix(prefix);
    const client = getRedisClient();
    if (!client) {
        const index = memoryGet(key);
        return index
            ? { built: true, entry: index[base] || null }
            : { built: false, entry: null };
    }
    try {
        const [built, raw] = await client.hmget(key, MEDIA_BUILT_FIELD, base);
        if (!built) {
            return { built: false, entry: null };
        }
        return { built: true, entry: raw ? JSON.parse(raw) : null };
    } catch (err) {
        debug(`[Redis] Media index read failed for ${prefix}:`, err.message);
        return { built: false, entry: null };
    }
}

export async function setMediaIndex(prefix, entries) {
    const key = mediaKeyForPrefix(prefix);
    const client = getRedisClient();
    if (!client) {
        memorySet(key, entries);
        return;
    }
    try {
        const fields = { [MEDIA_BUILT_FIELD]: '1' };
        for (const [base, entry] of Object.entries(entries)) {
            fields[base] = JSON.stringify(entry);
        }
        await client
            .multi()
            .del(key)
            .hset(key, fields)
            .expire(key, DEFAULT_TTL_SEC)
            .exec();
    } catch (err) {
        debug(`[Redis] Media index write failed for ${prefix}:`, err.message);
        memorySet(key, entries);
    }
}

export async function clearMediaIndex(prefix) {
    const key = mediaKeyForPrefix(prefix);
    memoryCache.delete(key);
    const client = getRedisClient();
    if (!client) {
        return;
    }
    try {
        await client.del(key);
    } catch (err) {
        debug(`[Redis] Media index clear failed for ${prefix}:`, err.message);
    }
}

export default {
    getPreviewCache,
    setPreviewCache,
    addPreviewKey,
    clearPreviewCache,
    getMediaIndexEntry,
    setMediaIndex,
    clearMediaIndex,
};
