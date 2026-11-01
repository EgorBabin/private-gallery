import pool from '../db.js';
import { ensureSchema } from './schema.js';

// Журнал действий в PostgreSQL (страница «Журнал» в админке).
// Пишется всё, что делают вошедшие пользователи, и все попытки входа.
// Запросы ботов без сессии (они только стучатся в API) не пишутся.

const RETENTION_DEFAULT_DAYS = 180;
const rawRetentionDays = Number(
    process.env.AUDIT_LOG_RETENTION_DAYS || RETENTION_DEFAULT_DAYS,
);
const RETENTION_DAYS =
    Number.isInteger(rawRetentionDays) && rawRetentionDays > 0
        ? rawRetentionDays
        : RETENTION_DEFAULT_DAYS;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const AUDIT_CATEGORIES = [
    'auth',
    'admin',
    'activity',
    'security',
    'error',
];

const AUTH_PATH_RE = /^\/api\/(?:google|telegram|yandex|logout)(?:\/|$)/;
const ADMIN_PATH_RE =
    /^\/api\/(?:users|admin|gallery\/(?:upload|reorder|media-soft-delete|cards-admin|reconcile|pending-deletions))(?:\/|$)/;

function truncate(value, max) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** ✅ — успех, ❌/⚠️ и ошибки маршрутов — неудача, иначе без оценки. */
export function outcomeOf(action) {
    const text = String(action || '');
    if (text.startsWith('✅')) {
        return 'ok';
    }
    if (
        /^(❌|⚠️)/.test(text) ||
        /\b(error|failed)\b/i.test(text) ||
        /не удалось|ошибка/i.test(text)
    ) {
        return 'fail';
    }
    return null;
}

export function categoryOf(path, action) {
    if (AUTH_PATH_RE.test(path)) {
        return 'auth';
    }
    if (outcomeOf(action) === 'fail') {
        return 'error';
    }
    if (ADMIN_PATH_RE.test(path)) {
        return 'admin';
    }
    return 'activity';
}

/** Убирает служебные хэштеги вида "#gallery.js #upload" из описания. */
export function cleanDetails(extra) {
    if (extra === undefined || extra === null || extra === '') {
        return null;
    }
    const text = typeof extra === 'string' ? extra : JSON.stringify(extra);
    const cleaned = text
        .replace(/#[\w.-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned ? truncate(cleaned, 1000) : null;
}

export function writeAuditLog(entry) {
    ensureSchema()
        .then(() =>
            pool.query(
                `INSERT INTO public.audit_log
                    (category, outcome, action, details, meta, user_id, email, ip, device, method, path)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    entry.category,
                    entry.outcome,
                    truncate(entry.action, 300),
                    entry.details,
                    entry.meta ? JSON.stringify(entry.meta) : null,
                    Number.isInteger(Number(entry.userId))
                        ? Number(entry.userId)
                        : null,
                    entry.email ? truncate(entry.email, 254) : null,
                    entry.ip ? truncate(entry.ip, 64) : null,
                    entry.device ? truncate(entry.device, 120) : null,
                    entry.method ? truncate(entry.method, 10) : null,
                    entry.path ? truncate(entry.path, 300) : null,
                ],
            ),
        )
        .catch((err) => {
            console.error('Failed to write audit log:', err.message);
        });
}

/** Удаляет записи старше AUDIT_LOG_RETENTION_DAYS, раз в сутки (в worker). */
export function startAuditLogPruner() {
    const prune = () =>
        ensureSchema()
            .then(() =>
                pool.query(
                    `DELETE FROM public.audit_log
                     WHERE created_at < CURRENT_TIMESTAMP - make_interval(days => $1)`,
                    [RETENTION_DAYS],
                ),
            )
            .then((result) => {
                if (result.rowCount > 0) {
                    console.log(
                        `[audit-log] Pruned ${result.rowCount} old entries`,
                    );
                }
            })
            .catch((err) => {
                console.error('[audit-log] Prune failed:', err.message);
            });

    void prune();
    const timer = setInterval(prune, PRUNE_INTERVAL_MS);
    timer.unref();
    return async () => clearInterval(timer);
}
