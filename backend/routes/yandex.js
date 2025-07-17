import express from 'express'
import pool from '../db.js'
import { logAction } from '../utils/logger.js'

const router = express.Router()

router.get('/auth/yandex', async (req, res) => {
    await logAction(req, 'Яндекс');
    const redirectUri = 'https://oauth.yandex.ru/authorize' +
        `?response_type=code` +
        `&client_id=${process.env.YANDEX_CLIENT_ID}` +
        `&redirect_uri=${process.env.YANDEX_REDIRECT_URI}` +
        `&scope=login:email`;

    res.redirect(redirectUri);
});

router.get('/auth/yandex/callback', async (req, res) => {
    await logAction(req, 'Получение данных', 'Yandex');
    const { code } = req.query;
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

    const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
        headers: {
            Authorization: `OAuth ${accessToken}`,
        },
    });
    const userInfo = await infoRes.json();

    const email = userInfo.default_email;

    // Найти пользователя по email и телефону
    const userQuery = `
        SELECT * FROM users
        WHERE $1 = ANY(email)
    `;
    const { rows } = await pool.query(userQuery, [email]);

    if (rows.length === 0) {
        await logAction(req, 'Пользователь не найден', 'Yandex');
        return res.status(401).json({ error: 'Пользователь не найден' });
    }

    // Сессия
    req.session.user = { id: rows[0].id, username: rows[0].username };
    await logAction(req, 'Пользователь авторизовался', 'Yandex')
    res.redirect('http://localhost:5173'); // на фронт

    } catch (err) {
        console.error(err);
        await logAction(req, 'Ошибка авторизации через Яндекс')
        res.status(500).json({ error: 'Ошибка авторизации через Яндекс' });
    }
});

export default router