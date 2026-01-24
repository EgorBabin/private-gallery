import express from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';

const router = express.Router();

function verifyTelegramAuth(query, botToken) {
    const { hash, ...rest } = query;
    if (!hash) {
        return false;
    }

    const keys = Object.keys(rest).sort();
    const dataCheckArr = keys.map((k) => `${k}=${rest[k]}`);
    const dataCheckString = dataCheckArr.join('\n');

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const hmac = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    try {
        const given = Buffer.from(hash, 'hex');
        const calc = Buffer.from(hmac, 'hex');
        if (given.length !== calc.length) {
            return false;
        }
        return crypto.timingSafeEqual(given, calc);
    } catch (e) {
        return false;
    }
}

const MAX_AGE = 24 * 60 * 60; // 24 часа

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

        const authDate = Number(req.query.auth_date) || 0;
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > MAX_AGE) {
            logAction(req, '⚠️ Устаревший auth_date в Telegram callback');
            return res.redirect(process.env.FRONTEND_URL);
        }

        const tgID = req.query.id || null;
        if (!tgID) {
            logAction(
                req,
                '❌ В callback отсутствует id — не с чем сверять пользователя',
            );
            return res
                .status(401)
                .json({ error: 'Нет telegram id для сопоставления' });
        }

        try {
            const userQuery = `
        SELECT * FROM users
        WHERE phone = $1
        LIMIT 1
      `;
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
