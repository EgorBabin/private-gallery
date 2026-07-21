import { getRedisClient } from './redisClient.js';

const PREVIEW_KEY_PREFIX = 'gallery:preview:'; // gallery:preview:2024/event
const DEFAULT_TTL_SEC = Number(process.env.REDIS_CACHE_TTL_SEC || 24 * 60 * 60); // 24h

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
        return JSON.parse(raw);
    } catch (err) {
        console.error('Redis getPreviewCache failed', key, err);
        return null;
    }
}

export async function setPreviewCache(prefix, items) {
    const client = getRedisClient();
    if (!client) return;
    const key = cacheKeyForPrefix(prefix);
    try {
        await client.set(key, JSON.stringify(items || []), 'EX', DEFAULT_TTL_SEC);
    } catch (err) {
        console.error('Redis setPreviewCache failed', key, err);
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
        console.error('Redis addPreviewKey failed', key, err);
    }
}

export async function clearPreviewCache(prefix) {
    const client = getRedisClient();
    if (!client) return;
    const key = cacheKeyForPrefix(prefix);
    try {
        await client.del(key);
    } catch (err) {
        console.error('Redis clearPreviewCache failed', key, err);
    }
}

export default { getPreviewCache, setPreviewCache, addPreviewKey, clearPreviewCache };
