import express from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';

const router = express.Router();

const TG_FIELDS = [
    'id',
    'first_name',
    'last_name',
    'username',
    'photo_url',
    'auth_date',
];
const MAX_AGE = 24 * 60 * 60;

function verifyTelegramAuth(query, botToken) {
    const hash = query.hash;
    if (!hash) {
        return false;
    }

    const data = {};
    for (const key of TG_FIELDS) {
        if (query[key]) {
            data[key] = query[key];
        }
    }

    const dataCheckString = Object.keys(data)
        .sort()
        .map((k) => `${k}=${data[k]}`)
        .join('\n');

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const hmac = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');
    try {
        return crypto.timingSafeEqual(
            Buffer.from(hash, 'hex'),
            Buffer.from(hmac, 'hex'),
        );
    } catch (e) {
        return false;
    }
}

router.get('/', async (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }

    const remember = req.query.remember === '1' ? '1' : '0';

    if (req.query.hash && req.query.id && req.query.auth_date) {
        logAction(req, '📥 Telegram callback');

        const botToken = process.env.TG_BOT_TOKEN;
        const valid = verifyTelegramAuth(req.query, botToken);
        if (!valid) {
            logAction(req, '❌ Невалидный hash в Telegram callback');
            return res.redirect(process.env.FRONTEND_URL);
        }

        const authDate = Number(req.query.auth_date);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > MAX_AGE) {
            logAction(req, '⚠️ Устаревший auth_date в Telegram callback');
            return res.redirect(process.env.FRONTEND_URL);
        }

        const tgID = String(req.query.id);

        const usedCheck = await pool.query(
            `SELECT 1 FROM telegram_auth_used WHERE tg_id=$1 AND auth_date=$2`,
            [tgID, authDate],
        );
        if (usedCheck.rowCount > 0) {
            logAction(
                req,
                '⚠️ Попытка повторного использования Telegram ссылки',
                tgID,
            );
            return res.redirect(process.env.FRONTEND_URL);
        }
        await pool.query(
            `INSERT INTO telegram_auth_used(tg_id, auth_date) VALUES($1,$2)`,
            [tgID, authDate],
        );

        try {
            const userQuery = `SELECT * FROM users WHERE telegramID = $1 LIMIT 1`;
            const { rows } = await pool.query(userQuery, [tgID]);

            if (rows.length === 0) {
                logAction(req, '❌ Пользователь не найден (по ID)', tgID);
                return res
                    .status(401)
                    .json({ error: 'Пользователь не найден', id: tgID });
            }

            const user = rows[0];

            req.session.regenerate((err) => {
                if (err) {
                    console.error('Ошибка сессии:', err);
                    return res.status(500).json({ error: 'Session error' });
                }

                req.session.user = {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    authType: 'telegram',
                };
                req.session.ip =
                    req.headers['x-forwarded-for']?.split(',')[0] ||
                    req.socket.remoteAddress;
                req.session.ua = req.headers['user-agent'];

                if (remember === '1') {
                    req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
                } else {
                    req.session.cookie.expires = false;
                }

                logAction(
                    req,
                    '✅ Пользователь авторизовался через Telegram',
                    `@${tgID}`,
                );
                res.redirect(process.env.FRONTEND_URL);
            });
        } catch (err) {
            console.error(err);
            logAction(req, '❌ Ошибка авторизации через Telegram');
            res.status(500).json({
                error: 'Ошибка авторизации через Telegram',
            });
        }
        return;
    }
    res.redirect(process.env.FRONTEND_URL);
});

export default router;
