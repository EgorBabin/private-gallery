import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || null;
let client = null;
let isRedisEnabled = false;

try {
    if (redisUrl) {
        client = new Redis(redisUrl, {
            retryStrategy: () => null, // disable retry, graceful fail instead
            enableOfflineQueue: false,
            maxRetriesPerRequest: null,
        });
        isRedisEnabled = true;
    } else if (process.env.REDIS_HOST) {
        client = new Redis({
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT || 6379),
            password: process.env.REDIS_PASSWORD || undefined,
            retryStrategy: () => null,
            enableOfflineQueue: false,
            maxRetriesPerRequest: null,
        });
        isRedisEnabled = true;
    }

    // Add error handler to suppress unhandled error events
    if (client) {
        client.on('error', (err) => {
            if (isRedisEnabled) {
                console.warn('[Redis] Connection error (cache disabled until restored):', err.message);
                client = null; // disable client on error
            }
        });

        client.on('connect', () => {
            console.log('[Redis] Connected');
        });

        client.on('close', () => {
            console.log('[Redis] Connection closed');
            client = null;
        });
    }
} catch (err) {
    console.warn('[Redis] Failed to initialize client:', err.message);
    client = null;
}

export function getRedisClient() {
    return client;
}

export default getRedisClient;
