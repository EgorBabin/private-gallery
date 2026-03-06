import express from 'express';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

const router = express.Router();

const EMAIL_RE = /^[a-zA-Z0-9._-]+@(yandex\.ru|gmail\.com)$/;
const TELEGRAM_ID_RE = /^\d{4,20}$/;
const USERNAME_RE = /^[a-zA-Zа-яА-ЯёЁ_-]{3,64}$/;
const ALLOWED_ROLES = new Set(['user', 'admin']);

class ValidationError extends Error {}

function normalizeUser(row) {
    if (!row) {
        return row;
    }
    const { telegramid, ...rest } = row;
    return { ...rest, telegramID: telegramid ?? null };
}

function parseUserId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationError('Некорректный id пользователя');
    }
    return id;
}

function normalizeUsername(value, { required = false } = {}) {
    if (value === undefined) {
        if (required) {
            throw new ValidationError('Имя пользователя обязательно');
        }
        return undefined;
    }

    const username = String(value || '').trim();
    if (!username) {
        if (required) {
            throw new ValidationError('Имя пользователя обязательно');
        }
        return undefined;
    }

    if (!USERNAME_RE.test(username)) {
        throw new ValidationError(
            'Имя пользователя: 3-64 символа, только буквы, "_" и "-" без цифр',
        );
    }

    return username;
}

function normalizeEmailArray(value, { required = false } = {}) {
    if (value === undefined) {
        if (required) {
            throw new ValidationError('Email обязателен');
        }
        return undefined;
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('Email должен быть массивом');
    }

    const emails = value
        .map((item) =>
            String(item || '')
                .trim()
                .toLowerCase(),
        )
        .filter(Boolean);

    if (required && emails.length === 0) {
        throw new ValidationError('Нужен хотя бы один email');
    }

    if (emails.length > 10) {
        throw new ValidationError('Слишком много email адресов');
    }

    const unique = [...new Set(emails)];
    for (const email of unique) {
        if (!EMAIL_RE.test(email)) {
            throw new ValidationError(
                'Email должен быть с доменом @yandex.ru или @gmail.com',
            );
        }
    }

    return unique;
}

function normalizeTelegramId(value, { required = false } = {}) {
    if (value === undefined) {
        if (required) {
            throw new ValidationError('Telegram ID обязателен');
        }
        return undefined;
    }

    if (value === null) {
        if (required) {
            throw new ValidationError('Telegram ID обязателен');
        }
        return null;
    }

    const telegramID = String(value).trim();
    if (!telegramID) {
        if (required) {
            throw new ValidationError('Telegram ID обязателен');
        }
        return null;
    }

    if (!TELEGRAM_ID_RE.test(telegramID)) {
        throw new ValidationError('Некорректный формат ID telegram');
    }

    return telegramID;
}

function normalizeRole(value, { required = false } = {}) {
    if (value === undefined) {
        if (required) {
            throw new ValidationError('Роль обязательна');
        }
        return undefined;
    }

    const role = String(value || '')
        .trim()
        .toLowerCase();
    if (!role) {
        if (required) {
            throw new ValidationError('Роль обязательна');
        }
        return undefined;
    }

    if (!ALLOWED_ROLES.has(role)) {
        throw new ValidationError('Роль должна быть user или admin');
    }

    return role;
}

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, username, email, telegramID, role, created_at, is_active FROM users ORDER BY id ASC',
        );
        return sendSuccess(res, {
            message: 'Пользователи загружены',
            payload: { users: rows.map(normalizeUser) },
        });
    } catch (err) {
        console.error(err);
        return sendError(res, {
            httpStatus: 500,
            message: 'Не удалось загрузить пользователей',
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const body = req.body || {};
        const username = normalizeUsername(body.username, { required: true });
        const email = normalizeEmailArray(body.email, { required: true });
        const telegramID = normalizeTelegramId(body.telegramID, {
            required: true,
        });
        const role = normalizeRole(body.role) || 'user';

        const { rows } = await pool.query(
            `
                INSERT INTO users (username, email, telegramID, role)
                VALUES ($1, $2, $3, $4)
                RETURNING id, username, email, telegramID, role, created_at, is_active
            `,
            [username, email, telegramID, role],
        );
        logAction(req, 'Добавлен новый пользователь', '#users.js');
        return sendSuccess(res, {
            httpStatus: 201,
            message: 'Пользователь создан',
            payload: { user: normalizeUser(rows[0]) },
        });
    } catch (err) {
        if (err?.code === '23505') {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message: 'Пользователь с таким именем уже существует',
            });
        }

        if (err instanceof ValidationError) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: err.message,
            });
        }

        console.error(err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось создать пользователя',
        });
        logAction(req, 'Failed to create user', '#users.js');
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = parseUserId(req.params.id);
        const { rowCount } = await pool.query(
            'DELETE FROM users WHERE id = $1',
            [id],
        );
        if (rowCount === 0) {
            return sendError(res, {
                httpStatus: 404,
                status: 'warning',
                message: 'Пользователь не найден',
            });
        }

        sendSuccess(res, { message: 'Пользователь удалён' });
        logAction(req, 'Пользователь удалён', '#users.js');
    } catch (err) {
        if (err instanceof ValidationError) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: err.message,
            });
        }
        console.error(err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось удалить пользователя',
        });
        logAction(req, 'Не удалось удалить пользователя', '#users.js');
    }
});

router.put('/:id', async (req, res) => {
    try {
        const id = parseUserId(req.params.id);
        const body = req.body || {};
        const patch = {};

        const username = normalizeUsername(body.username);
        if (username !== undefined) {
            patch.username = username;
        }

        const email = normalizeEmailArray(body.email);
        if (email !== undefined) {
            patch.email = email;
        }

        const telegramID = normalizeTelegramId(body.telegramID);
        if (telegramID !== undefined) {
            patch.telegramID = telegramID;
        }

        const role = normalizeRole(body.role);
        if (role !== undefined) {
            patch.role = role;
        }

        if (Object.keys(patch).length === 0) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: 'Нет полей для обновления',
            });
        }

        const values = [];
        const sets = [];
        let index = 1;

        for (const [key, value] of Object.entries(patch)) {
            sets.push(`${key} = $${index}`);
            values.push(value);
            index += 1;
        }

        values.push(id);
        const { rows } = await pool.query(
            `
                UPDATE users
                SET ${sets.join(', ')}
                WHERE id = $${index}
                RETURNING id, username, email, telegramID, role, created_at, is_active
            `,
            values,
        );

        if (rows.length === 0) {
            logAction(req, 'Пользователь не найден', '#users.js');
            return sendError(res, {
                httpStatus: 404,
                status: 'warning',
                message: 'Пользователь не найден',
            });
        }

        sendSuccess(res, {
            message: 'Пользователь обновлён',
            payload: { user: normalizeUser(rows[0]) },
        });
        logAction(req, 'Пользователь обновлён', '#users.js');
    } catch (err) {
        if (err?.code === '23505') {
            return sendError(res, {
                httpStatus: 409,
                status: 'warning',
                message: 'Пользователь с таким именем уже существует',
            });
        }

        if (err instanceof ValidationError) {
            return sendError(res, {
                httpStatus: 400,
                status: 'warning',
                message: err.message,
            });
        }

        console.error(err);
        sendError(res, {
            httpStatus: 500,
            message: 'Не удалось обновить пользователя',
        });
        logAction(req, 'Не удалось обновить пользователя', '#users.js');
    }
});

export default router;
