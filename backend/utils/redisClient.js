import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || null;

// Кэш необязателен: пока Redis недоступен, команды сразу падают
// (enableOfflineQueue: false), а клиент сам переподключается в фоне.
const COMMON_OPTIONS = {
    retryStrategy: (times) => Math.min(times * 500, 5000),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
};

let client = null;
let lastErrorLogged = false;

try {
    if (redisUrl) {
        client = new Redis(redisUrl, COMMON_OPTIONS);
    } else if (process.env.REDIS_HOST) {
        client = new Redis({
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT || 6379),
            password: process.env.REDIS_PASSWORD || undefined,
            ...COMMON_OPTIONS,
        });
    }

    if (client) {
        client.on('error', (err) => {
            // одно сообщение на обрыв, а не на каждую попытку переподключения
            if (!lastErrorLogged) {
                console.warn(
                    '[Redis] Connection error, cache disabled until reconnect:',
                    err.message,
                );
                lastErrorLogged = true;
            }
        });

        client.on('ready', () => {
            console.log('[Redis] Connected');
            lastErrorLogged = false;
        });
    }
} catch (err) {
    console.warn('[Redis] Failed to initialize client:', err.message);
    client = null;
}

export function getRedisClient() {
    return client && client.status === 'ready' ? client : null;
}

export default getRedisClient;
