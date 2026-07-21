import { getRedisClient } from './redisClient.js';

const PREVIEW_KEY_PREFIX = 'gallery:preview:'; // gallery:preview:2024/event
const DEFAULT_TTL_SEC = Number(process.env.REDIS_CACHE_TTL_SEC || 24 * 60 * 60); // 24h
const IS_DEBUG_LOGS = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

function cacheKeyForPrefix(prefix) {
    // prefix expected like '2024/event' (no leading/trailing slash)
    return `${PREVIEW_KEY_PREFIX}${String(prefix || '').replace(/^\/+|\/+$/g, '')}`;
}

export async function getPreviewCache(prefix) {
    const client = getRedisClient();
    if (!client) return null;
    const key = cacheKeyForPrefix(prefix);
    try {
        const raw = await client.get(key);
        if (!raw) return null;
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Cache hit for ${prefix}`);
        }
        return JSON.parse(raw);
    } catch (err) {
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Cache read failed for ${prefix}:`, err.message);
        }
        return null;
    }
}

export async function setPreviewCache(prefix, items) {
    const client = getRedisClient();
    if (!client) return;
    const key = cacheKeyForPrefix(prefix);
    try {
        await client.set(key, JSON.stringify(items || []), 'EX', DEFAULT_TTL_SEC);
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Cache set for ${prefix} (${items?.length || 0} items)`);
        }
    } catch (err) {
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Cache write failed for ${prefix}:`, err.message);
        }
    }
}

export async function addPreviewKey(prefix, item) {
    // item: { key, size?, lastModified? }
    const client = getRedisClient();
    if (!client) return;
    const key = cacheKeyForPrefix(prefix);
    try {
        const raw = await client.get(key);
        const list = raw ? JSON.parse(raw) : [];
        // avoid duplicates by key
        const exists = list.find((i) => i.key === item.key);
        if (!exists) {
            list.push(item);
            await client.set(key, JSON.stringify(list), 'EX', DEFAULT_TTL_SEC);
        }
    } catch (err) {
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Add preview key failed for ${prefix}:`, err.message);
        }
    }
}

export async function clearPreviewCache(prefix) {
    const client = getRedisClient();
    if (!client) return;
    const key = cacheKeyForPrefix(prefix);
    try {
        await client.del(key);
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Cache cleared for ${prefix}`);
        }
    } catch (err) {
        if (IS_DEBUG_LOGS) {
            console.debug(`[Redis] Cache clear failed for ${prefix}:`, err.message);
        }
    }
}

export default { getPreviewCache, setPreviewCache, addPreviewKey, clearPreviewCache };
