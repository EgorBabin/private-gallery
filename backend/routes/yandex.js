import express from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { logAction } from '../utils/logger.js';

const router = express.Router();
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }

    logAction(req, '👁️‍🗨️ Yandex');
    const remember = req.query.remember === '1' ? '1' : '0';
    const state = crypto.randomBytes(24).toString('hex');
    req.session.yandexAuthState = {
        value: state,
        remember,
        createdAt: Date.now(),
    };

    const redirectUri =
        'https://oauth.yandex.ru/authorize' +
        `?response_type=code` +
        `&client_id=${process.env.YANDEX_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.YANDEX_REDIRECT_URI)}` +
        `&scope=login:email` +
        `&state=${encodeURIComponent(state)}`;

    req.session.save((err) => {
        if (err) {
            console.error('Failed to persist yandex oauth state:', err);
            return res.status(500).json({ error: 'Session error' });
        }
        return res.redirect(redirectUri);
    });
});

router.get('/callback', async (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }

    const { code, state } = req.query;
    const savedState = req.session?.yandexAuthState;
    const remember = savedState?.remember === '1' ? '1' : '0';
    req.session.yandexAuthState = null;

    const isStateValid =
        typeof state === 'string' &&
        typeof savedState?.value === 'string' &&
        state === savedState.value &&
        Date.now() - Number(savedState.createdAt || 0) <=
            OAUTH_STATE_MAX_AGE_MS;

    if (!code || !isStateValid) {
        logAction(req, '⚠️ Невалидный OAuth callback (code/state)', 'Yandex');
        return res.redirect(process.env.FRONTEND_URL);
    }

    logAction(req, '📥 Получение данных', 'Yandex');

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

        if (!tokenRes.ok) {
            const tokenError = await tokenRes.text();
            throw new Error(`Yandex token exchange failed: ${tokenError}`);
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) {
            throw new Error('Yandex access token is missing');
        }

        const infoRes = await fetch(
            'https://login.yandex.ru/info?format=json',
            {
                headers: {
                    Authorization: `OAuth ${accessToken}`,
                },
            },
        );
        if (!infoRes.ok) {
            const infoError = await infoRes.text();
            throw new Error(`Yandex profile fetch failed: ${infoError}`);
        }
        const userInfo = await infoRes.json();

        if (
            typeof userInfo.default_email !== 'string' ||
            !userInfo.default_email.trim()
        ) {
            throw new Error('Yandex profile email is missing');
        }
        const email = userInfo.default_email.trim().toLowerCase();

        const userQuery = `
            SELECT * FROM users
            WHERE $1 = ANY(email)
            LIMIT 1
        `;
        const { rows } = await pool.query(userQuery, [email]);

        if (rows.length === 0) {
            logAction(req, '❌ Пользователь не найден', email);
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
                role: rows[0].role || 'user',
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
        logAction(req, '❌ Ошибка авторизации через Яндекс');
        res.status(500).json({ error: 'Ошибка авторизации через Яндекс' });
    }
});

export default router;
