import express from 'express';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';
import { AUDIT_CATEGORIES } from '../utils/auditLog.js';
import { ensureSchema } from '../utils/schema.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

// Только для админа (server.js: checkSession + requireRole('admin')).
const router = express.Router();

const LOGS_PAGE_DEFAULT = 100;
const LOGS_PAGE_MAX = 300;
const ONLINE_WINDOW_MIN = 5;

// Таблица сессий connect-pg-simple создаётся при первом входе, поэтому её
// отсутствие на свежей базе — не ошибка.
async function activeSessionsByUser() {
    try {
        const { rows } = await pool.query(
            `SELECT sess->'user'->>'id' AS user_id, count(*)::int AS sessions
             FROM "session"
             WHERE expire > CURRENT_TIMESTAMP AND sess->'user' IS NOT NULL
             GROUP BY 1`,
        );
        return new Map(rows.map((row) => [Number(row.user_id), row.sessions]));
    } catch (err) {
        if (err.code === '42P01') {
            return new Map();
        }
        throw err;
    }
}

// GET /api/admin/stats — пользователи, их активность и общие цифры
router.get('/stats', async (req, res) => {
    try {
        await ensureSchema();
        const [users, activity, lastLogins, totals, sessions] =
            await Promise.all([
                pool.query(
                    `SELECT id, username, role, is_active, email, created_at,
                            last_login_at, last_login_method, last_seen_at
                     FROM users
                     ORDER BY is_active DESC, last_seen_at DESC NULLS LAST, id`,
                ),
                pool.query(
                    `SELECT user_id,
                        count(*) FILTER (WHERE category = 'auth' AND outcome = 'ok')::int AS logins,
                        coalesce(sum((meta->>'uploaded')::int) FILTER (WHERE meta ? 'uploaded'), 0)::int AS uploaded,
                        count(*) FILTER (WHERE action = 'Открыл папку')::int AS folder_views,
                        count(DISTINCT meta->>'folder') FILTER (WHERE action = 'Открыл папку')::int AS folders_seen
                     FROM public.audit_log
                     WHERE user_id IS NOT NULL
                     GROUP BY user_id`,
                ),
                // откуда был последний вход: IP и устройство
                pool.query(
                    `SELECT DISTINCT ON (user_id) user_id, ip, device, created_at
                     FROM public.audit_log
                     WHERE category = 'auth' AND outcome = 'ok' AND user_id IS NOT NULL
                     ORDER BY user_id, created_at DESC`,
                ),
                pool.query(
                    `SELECT
                        (SELECT count(*) FROM public.cards)::int AS folders,
                        (SELECT coalesce(sum(image_count), 0) FROM public.cards)::int AS media,
                        (SELECT count(*) FROM public.audit_log
                            WHERE category = 'auth' AND outcome = 'ok'
                              AND created_at > CURRENT_TIMESTAMP - interval '7 days')::int AS logins7d,
                        (SELECT count(*) FROM public.audit_log
                            WHERE category = 'auth' AND outcome = 'fail'
                              AND created_at > CURRENT_TIMESTAMP - interval '7 days')::int AS failedLogins7d,
                        (SELECT coalesce(sum((meta->>'uploaded')::int), 0) FROM public.audit_log
                            WHERE meta ? 'uploaded'
                              AND created_at > CURRENT_TIMESTAMP - interval '30 days')::int AS uploads30d`,
                ),
                activeSessionsByUser(),
            ]);

        const activityById = new Map(
            activity.rows.map((row) => [row.user_id, row]),
        );
        const lastLoginById = new Map(
            lastLogins.rows.map((row) => [row.user_id, row]),
        );
        const onlineSince = Date.now() - ONLINE_WINDOW_MIN * 60 * 1000;

        const list = users.rows.map((user) => {
            const stats = activityById.get(user.id) || {};
            const lastLogin = lastLoginById.get(user.id) || null;
            return {
                id: user.id,
                username: user.username,
                role: user.role,
                isActive: user.is_active !== false,
                email: user.email || [],
                createdAt: user.created_at,
                lastLoginAt: user.last_login_at,
                lastLoginMethod: user.last_login_method,
                lastLoginIp: lastLogin?.ip || null,
                lastLoginDevice: lastLogin?.device || null,
                lastSeenAt: user.last_seen_at,
                online:
                    Boolean(user.last_seen_at) &&
                    new Date(user.last_seen_at).getTime() >= onlineSince,
                activeSessions: sessions.get(user.id) || 0,
                logins: stats.logins || 0,
                uploaded: stats.uploaded || 0,
                folderViews: stats.folder_views || 0,
                foldersSeen: stats.folders_seen || 0,
            };
        });

        const t = totals.rows[0] || {};
        return sendSuccess(res, {
            message: 'Статистика загружена',
            payload: {
                users: list,
                totals: {
                    users: list.length,
                    activeUsers: list.filter((u) => u.isActive).length,
                    onlineUsers: list.filter((u) => u.online).length,
                    folders: t.folders || 0,
                    media: t.media || 0,
                    logins7d: t.logins7d || 0,
                    failedLogins7d: t.failedlogins7d || 0,
                    uploads30d: t.uploads30d || 0,
                },
            },
        });
    } catch (err) {
        console.error('admin stats error', err);
        return sendError(res, {
            httpStatus: 500,
            message: 'Не удалось загрузить статистику',
        });
    }
});

// GET /api/admin/logs?limit=100&before=<id>&after=<id>&q=&category=&userId=&order=desc
router.get('/logs', async (req, res) => {
    try {
        await ensureSchema();
        const limit = Math.min(
            Math.max(
                Number.parseInt(req.query.limit, 10) || LOGS_PAGE_DEFAULT,
                1,
            ),
            LOGS_PAGE_MAX,
        );
        const ascending = req.query.order === 'asc';
        const where = [];
        const params = [];
        const param = (value) => {
            params.push(value);
            return `$${params.length}`;
        };

        const cursor = Number.parseInt(
            ascending ? req.query.after : req.query.before,
            10,
        );
        if (Number.isInteger(cursor) && cursor > 0) {
            where.push(`id ${ascending ? '>' : '<'} ${param(cursor)}`);
        }

        const category = String(req.query.category || '');
        if (AUDIT_CATEGORIES.includes(category)) {
            where.push(`category = ${param(category)}`);
        }
        if (req.query.outcome === 'fail' || req.query.outcome === 'ok') {
            where.push(`outcome = ${param(req.query.outcome)}`);
        }

        const userId = Number.parseInt(req.query.userId, 10);
        if (Number.isInteger(userId) && userId > 0) {
            where.push(`user_id = ${param(userId)}`);
        }

        const q = String(req.query.q || '')
            .trim()
            .slice(0, 100);
        if (q) {
            const like = param(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
            where.push(
                `(action ILIKE ${like} OR details ILIKE ${like} OR email ILIKE ${like} OR ip ILIKE ${like} OR path ILIKE ${like} OR device ILIKE ${like})`,
            );
        }

        const { rows } = await pool.query(
            `SELECT id, created_at, category, outcome, action, details, meta,
                    user_id, email, ip, device, method, path
             FROM public.audit_log
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY id ${ascending ? 'ASC' : 'DESC'}
             LIMIT ${param(limit + 1)}`,
            params,
        );

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;

        return sendSuccess(res, {
            message: 'Журнал загружен',
            payload: {
                items: items.map((row) => ({
                    id: Number(row.id),
                    createdAt: row.created_at,
                    category: row.category,
                    outcome: row.outcome,
                    action: row.action,
                    details: row.details,
                    meta: row.meta,
                    userId: row.user_id,
                    email: row.email,
                    ip: row.ip,
                    device: row.device,
                    method: row.method,
                    path: row.path,
                })),
                nextCursor: nextCursor ? Number(nextCursor) : null,
            },
        });
    } catch (err) {
        console.error('admin logs error', err);
        return sendError(res, {
            httpStatus: 500,
            message: 'Не удалось загрузить журнал',
        });
    }
});

// POST /api/admin/users/:id/revoke-sessions — выйти на всех устройствах
router.post('/users/:id/revoke-sessions', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
        return sendError(res, {
            httpStatus: 400,
            status: 'warning',
            message: 'Некорректный id пользователя',
        });
    }
    try {
        const { rowCount } = await pool.query(
            `DELETE FROM "session" WHERE sess->'user'->>'id' = $1`,
            [String(id)],
        );
        logAction(
            req,
            'Завершены сессии пользователя',
            `id ${id}: ${rowCount}`,
            {
                category: 'security',
                meta: { targetUserId: id, sessions: rowCount },
            },
        );
        return sendSuccess(res, {
            message: `Завершено сессий: ${rowCount}`,
            payload: { revoked: rowCount },
        });
    } catch (err) {
        if (err.code === '42P01') {
            return sendSuccess(res, {
                message: 'Активных сессий нет',
                payload: { revoked: 0 },
            });
        }
        console.error('revoke sessions error', err);
        return sendError(res, {
            httpStatus: 500,
            message: 'Не удалось завершить сессии',
        });
    }
});

export default router;
