import 'dotenv/config';
import express from 'express';
import session from 'express-session';

import helmet from 'helmet';

import { csrfProtection, csrfTokenHandler } from './utils/csrf.js';
import { rateLimit } from './utils/rateLimit.js';

import pgSession from 'connect-pg-simple';
import pool from './db.js';
import cors from 'cors'; // for local use
import useragent from 'express-useragent';

import checkWork from './routes/hello.js';
import usersRoutes from './routes/users.js';
import telegramRoutes from './routes/telegram.js';
import yandexRoutes from './routes/yandex.js';
import authCheck from './utils/authCheck.js';
import requireRole from './utils/requireRole.js';

import checkSession from './utils/checkSession.js';

import galleryRoutes from './routes/gallery.js';
import galleryEditRoutes from './routes/galleryEdit.js';

const app = express();
const RATE_LIMIT_PER_MINUTE =
    Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE || '', 10) || 600;
const requireAdmin = requireRole('admin');

if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required');
}

app.set('trust proxy', 1);

app.use(helmet());

// общий лимит на API и отдельный, строже, на вход (перебор/спам ботов)
app.use(
    '/api/',
    rateLimit({ windowMs: 60 * 1000, max: RATE_LIMIT_PER_MINUTE }),
);
app.use(
    ['/api/telegram', '/api/yandex'],
    rateLimit({ windowMs: 10 * 60 * 1000, max: 30 }),
);

app.use(
    cors({
        origin: process.env.FRONTEND_URL,
        credentials: true,
    }),
);

app.use(express.json());

const PgSession = pgSession(session);
app.use(
    session({
        store: new PgSession({
            pool,
            tableName: 'session',
            createTableIfMissing: true,
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: false,
        cookie: {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 1000 * 60 * 30, // 30 минут по умолчанию
        },
        name: process.env.SESSION,
    }),
);

app.use(csrfProtection);

app.get('/api/csrf-token', csrfTokenHandler);

// выход: удаляем сессию на сервере и cookie в браузере
app.post('/api/logout', (req, res) => {
    const finish = () => {
        res.clearCookie(process.env.SESSION || 'connect.sid', {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
        res.json({ ok: true });
    };
    if (!req.session) {
        return finish();
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout failed:', err.message);
            return res.status(500).json({ error: 'Internal error' });
        }
        return finish();
    });
});

app.use(useragent.express());

// Подключаем роуты
app.use('/api/', checkWork);
app.use('/api/telegram/', telegramRoutes);
app.use('/api/yandex/', yandexRoutes);
app.use('/api/check-session', authCheck);

app.use('/api/users/', checkSession(), requireAdmin, usersRoutes);
app.use('/api/gallery', checkSession(), galleryRoutes);
app.use('/api/gallery', checkSession(), requireAdmin, galleryEditRoutes);

app.use((err, req, res, next) => {
    void next;
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(3000, () => {
    console.log('HTTP сервер запущен на http://localhost:3000');
});
