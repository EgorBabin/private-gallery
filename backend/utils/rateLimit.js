// Простое ограничение частоты запросов по IP в памяти процесса (backend один).
// IP берётся из req.ip: при app.set('trust proxy', 1) это адрес клиента,
// который подставил Caddy, подделать его заголовком нельзя.

const MAX_TRACKED_IPS = 50000;

export function rateLimit({ windowMs, max }) {
    const hits = new Map();

    const cleanup = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now) {
                hits.delete(key);
            }
        }
    }, windowMs);
    cleanup.unref();

    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';

        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            if (hits.size >= MAX_TRACKED_IPS) {
                hits.clear();
            }
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }

        entry.count += 1;
        if (entry.count > max) {
            res.set(
                'Retry-After',
                String(Math.ceil((entry.resetAt - now) / 1000)),
            );
            return res.status(429).json({ error: 'Too many requests' });
        }
        return next();
    };
}
