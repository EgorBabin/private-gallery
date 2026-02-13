import 'dotenv/config';
import express from 'express';
import session from 'express-session';

import helmet from 'helmet';

import cookieParser from 'cookie-parser';
import csurf from 'csurf';

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
const IS_DEBUG_LOGS = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';
const requireAdmin = requireRole('admin');

if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required');
}

app.set('trust proxy', 1);

app.use(helmet());

app.use(cookieParser());

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

if (IS_DEBUG_LOGS) {
    app.use((req, res, next) => {
        console.log('CSRF cookie present:', Boolean(req.cookies._csrf));
        console.log('CSRF header present:', Boolean(req.get('X-CSRF-Token')));
        next();
    });
}

app.use(
    csurf({
        cookie: {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
        },
    }),
);

app.use((err, req, res, next) => {
    void next;
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next(err);
});

app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
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
