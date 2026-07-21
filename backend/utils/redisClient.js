import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || null;
const redisOpts = {};
let client;

if (redisUrl) {
    client = new Redis(redisUrl, redisOpts);
} else if (process.env.REDIS_HOST) {
    client = new Redis({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || undefined,
    });
} else {
    client = null;
}

export function getRedisClient() {
    return client;
}

export default getRedisClient;
