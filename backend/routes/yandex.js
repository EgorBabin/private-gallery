import express from 'express';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }

    await logAction(req, '👁️‍🗨️ Yandex');
    const remember = req.query.remember === '1' ? '1' : '0';
    const redirectUri =
        'https://oauth.yandex.ru/authorize' +
        `?response_type=code` +
        `&client_id=${process.env.YANDEX_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.YANDEX_REDIRECT_URI + '?remember=' + remember)}` +
        `&scope=login:email`;

    res.redirect(redirectUri);
});

router.get('/callback', async (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }

    const { code, remember } = req.query;
    if (!code) {
        await logAction(req, '⚠️ Нет кода авторизации в callback', 'Yandex');
        return res.redirect(process.env.FRONTEND_URL);
    }

    await logAction(req, '📥 Получение данных', 'Yandex');

    try {
        const tokenRes = await fetch('https://oauth.yandex.ru/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: process.env.YANDEX_CLIENT_ID,
                client_secret: process.env.YANDEX_CLIENT_SECRET,
            }),
        });

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        const infoRes = await fetch(
            'https://login.yandex.ru/info?format=json',
            {
                headers: {
                    Authorization: `OAuth ${accessToken}`,
                },
            },
        );
        const userInfo = await infoRes.json();

        const email = userInfo.default_email;

        // Найти пользователя по email и телефону
        const userQuery = `
        SELECT * FROM users
        WHERE $1 = ANY(email)
    `;
        const { rows } = await pool.query(userQuery, [email]);

        if (rows.length === 0) {
            await logAction(req, '❌ Пользователь не найден', email);
            return res
                .status(401)
                .json({ error: 'Пользователь не найден ', email });
        }

        req.session.regenerate((err) => {
            if (err) {
                console.error('Ошибка сессии:', err);
                return res.status(500).json({ error: 'Session error' });
            }

            req.session.user = {
                id: rows[0].id,
                username: rows[0].username,
                email: email,
                authType: 'yandex',
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

            logAction(req, '✅ Пользователь авторизовался');
            res.redirect(process.env.FRONTEND_URL);
            return;
        });
    } catch (err) {
        console.error(err);
        await logAction(req, '❌ Ошибка авторизации через Яндекс');
        res.status(500).json({ error: 'Ошибка авторизации через Яндекс' });
    }
});

export default router;
