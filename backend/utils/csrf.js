import crypto from 'crypto';

// Защита от CSRF вместо заброшенного csurf:
// - токен = HMAC(SESSION_SECRET, id сессии): ничего не хранится, отдельная
//   cookie не нужна, после входа (regenerate) токен автоматически меняется;
// - для изменяющих запросов дополнительно сверяется заголовок Origin.
// Фронтенд работает как раньше: GET /api/csrf-token и заголовок X-CSRF-Token.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function expectedOrigin() {
    try {
        return new URL(String(process.env.FRONTEND_URL || '')).origin;
    } catch {
        return null;
    }
}

function tokenForSession(sessionId) {
    return crypto
        .createHmac('sha256', String(process.env.SESSION_SECRET || ''))
        .update(`csrf:${sessionId}`)
        .digest('base64url');
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function csrfTokenHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: tokenForSession(req.sessionID) });
}

export function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
        return next();
    }

    const origin = req.get('origin');
    const allowedOrigin = expectedOrigin();
    if (origin && allowedOrigin && origin !== allowedOrigin) {
        return res.status(403).json({ error: 'Invalid origin' });
    }

    // Без пользователя в сессии изменить ничего нельзя: такие запросы дальше
    // получат 401 от checkSession, и фронтенд отправит на страницу входа.
    if (!req.session?.user) {
        return next();
    }

    if (!safeEqual(req.get('x-csrf-token'), tokenForSession(req.sessionID))) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    return next();
}
