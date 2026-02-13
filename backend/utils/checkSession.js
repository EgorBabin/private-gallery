import util from 'util';
import { logAction } from '../utils/logger.js';

// import checkSession from '../utils/checkSession.js';

// Защита конкретного роутера (все роуты внутри)
// const router = express.Router();
// router.use(checkSession());

// Отдельный endpoint
// app.get('/private-data', checkSession(), (req,res) => {
//     res.json({ secret: '...' });
// });

const DEFAULTS = {
    requiredFields: ['id', 'username', 'email', 'authType', 'role'],
    sessionCookieName: process.env.SESSION || 'session',
    frontendLoginPath: '/login',
    allowedRoles: ['user', 'admin'],
    treatEmpty: (v) =>
        v === null ||
        v === undefined ||
        (typeof v === 'string' && v.trim() === ''),
    enforceIpUaMatch: true, // проверка IP/UA
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isApiRequest(req) {
    return (
        req.xhr ||
        (req.headers.accept &&
            req.headers.accept.includes('application/json')) ||
        (req.headers['content-type'] &&
            req.headers['content-type'].includes('application/json')) ||
        req.originalUrl?.startsWith('/api')
    );
}

export default function checkSession(opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };

    return async (req, res, next) => {
        const missing = [];
        try {
            if (!req.session) {
                try {
                    logAction(req, 'Нет server-side сессии');
                } catch (err) {
                    console.debug('logAction failed (no session):', err);
                }
                try {
                    res.clearCookie(cfg.sessionCookieName, {
                        httpOnly: true,
                        secure:
                            req.secure ||
                            req.headers['x-forwarded-proto'] === 'https',
                        sameSite: 'lax',
                        path: '/',
                    });
                } catch (err) {
                    console.debug('clearCookie failed (no session):', err);
                }
                if (isApiRequest(req)) {
                    return res.status(401).json({ error: 'no_session' });
                }
                return res.redirect(cfg.frontendLoginPath);
            }

            const user = req.session.user;
            if (!user) {
                try {
                    logAction(req, 'req.session.user отсутствует');
                } catch (err) {
                    console.debug('logAction failed (no user):', err);
                }
                const destroyAsync = util
                    .promisify(req.session.destroy)
                    .bind(req.session);
                try {
                    await destroyAsync();
                } catch (err) {
                    console.debug('session.destroy failed (no user):', err);
                }
                try {
                    res.clearCookie(cfg.sessionCookieName, {
                        httpOnly: true,
                        secure:
                            req.secure ||
                            req.headers['x-forwarded-proto'] === 'https',
                        sameSite: 'lax',
                        path: '/',
                    });
                } catch (err) {
                    console.debug('clearCookie failed (no user):', err);
                }
                res.set('X-Redirect', cfg.frontendLoginPath);
                if (isApiRequest(req)) {
                    return res.status(401).json({
                        error: 'invalid_session',
                        redirect: cfg.frontendLoginPath,
                    });
                }
                return res.redirect(cfg.frontendLoginPath);
            }

            for (const f of cfg.requiredFields) {
                const v = user[f];
                if (cfg.treatEmpty(v)) {
                    missing.push(f);
                }
            }

            if (!missing.includes('id')) {
                const idVal = user.id;
                if (!Number.isInteger(Number(idVal))) {
                    missing.push('id(not-number)');
                }
            }
            if (!missing.includes('email')) {
                const emailVal = user.email;
                if (!emailRe.test(String(emailVal || ''))) {
                    missing.push('email(bad-format)');
                }
            }
            if (!missing.includes('role')) {
                const roleVal = String(user.role || '')
                    .trim()
                    .toLowerCase();
                if (!cfg.allowedRoles.includes(roleVal)) {
                    missing.push('role(invalid)');
                }
            }

            // IP/UA
            if (cfg.enforceIpUaMatch) {
                const currentIp =
                    req.headers['x-forwarded-for']?.split(',')[0] ||
                    req.socket.remoteAddress;
                const currentUa = req.headers['user-agent'];
                if (req.session.ip && req.session.ip !== currentIp) {
                    missing.push('ip_mismatch');
                }
                if (req.session.ua && req.session.ua !== currentUa) {
                    missing.push('ua_mismatch');
                }
            }

            if (missing.length > 0) {
                try {
                    logAction(
                        req,
                        `Сессия некорректна, удаляем. missing: ${missing.join(',')}`,
                    );
                } catch (err) {
                    console.debug('logAction failed (invalid session):', err);
                }

                const destroyAsync = util
                    .promisify(req.session.destroy)
                    .bind(req.session);
                try {
                    await destroyAsync();
                } catch (err) {
                    console.debug(
                        'session.destroy failed (invalid session):',
                        err,
                    );
                }

                try {
                    res.clearCookie(cfg.sessionCookieName, {
                        httpOnly: true,
                        secure:
                            req.secure ||
                            req.headers['x-forwarded-proto'] === 'https',
                        sameSite: 'lax',
                        path: '/',
                    });
                } catch (err) {
                    console.debug('clearCookie failed (invalid session):', err);
                }
                if (isApiRequest(req)) {
                    return res
                        .status(401)
                        .json({ error: 'invalid_session', missing });
                }
                return res.redirect(cfg.frontendLoginPath);
            }

            // ok
            return next();
        } catch (err) {
            console.error('checkSession error:', err);
            try {
                logAction(req, `Ошибка проверки сессии: ${err.message}`);
            } catch (logErr) {
                console.debug('logAction failed (exception):', logErr);
            }
            if (isApiRequest(req)) {
                return res.status(500).json({ error: 'internal' });
            }
            return res.redirect(cfg.frontendLoginPath);
        }
    };
}
