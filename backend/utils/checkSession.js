import util from 'util';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';

// Обычная сессия (без «Запомнить меня») живёт 30 минут с последнего запроса.
const SESSION_IDLE_MS = 1000 * 60 * 30;

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
    // Привязка к IP выключена по умолчанию: телефон меняет IP при переходе
    // Wi-Fi <-> мобильная сеть, и пользователя выкидывало из галереи.
    enforceIpMatch: process.env.SESSION_BIND_IP === 'true',
    enforceUaMatch: true,
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
                    logAction(req, 'Нет server-side сессии', '', {
                        notify: false,
                    });
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
                    logAction(req, 'req.session.user отсутствует', '', {
                        notify: false,
                    });
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
            if (cfg.enforceIpMatch) {
                const currentIp =
                    req.headers['x-forwarded-for']?.split(',')[0] ||
                    req.socket.remoteAddress;
                if (req.session.ip && req.session.ip !== currentIp) {
                    missing.push('ip_mismatch');
                }
            }
            if (cfg.enforceUaMatch) {
                const currentUa = req.headers['user-agent'];
                if (req.session.ua && req.session.ua !== currentUa) {
                    missing.push('ua_mismatch');
                }
            }

            // Сессия сверяется с базой на каждом запросе: удалённый или
            // отключённый пользователь теряет доступ сразу, а не когда истечёт
            // сессия (до 30 дней), снятая роль admin тоже действует сразу.
            if (missing.length === 0) {
                const { rows } = await pool.query(
                    'SELECT role, is_active FROM users WHERE id = $1',
                    [Number(user.id)],
                );
                const dbUser = rows[0];
                if (!dbUser || dbUser.is_active === false) {
                    missing.push('user_revoked');
                } else {
                    const dbRole = String(dbUser.role || 'user')
                        .trim()
                        .toLowerCase();
                    if (dbRole !== String(user.role).trim().toLowerCase()) {
                        req.session.user.role = dbRole;
                    }
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

            // скользящий таймаут для обычных сессий; «Запомнить меня» (30 дней)
            // не сокращается
            if (!(req.session.cookie.originalMaxAge > SESSION_IDLE_MS)) {
                req.session.cookie.maxAge = SESSION_IDLE_MS;
            }

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
