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
import yandexRoutes from './routes/yandex.js';
import authCheck from './utils/authCheck.js';
import { logAction } from './utils/logger.js';

import checkSession from './utils/checkSession.js';

import galleryRoutes from './routes/gallery.js';
import galleryEditRoutes from './routes/galleryEdit.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

app.use(cookieParser());

// for local use
app.use(
    cors({
        origin: process.env.FRONTEND_URL, // фронт
        credentials: true, // чтобы работали cookies
    }),
);
// // for local use

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
        resave: true,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            secure: true, // в проде — true // for local use
            sameSite: 'lax',
            maxAge: 1000 * 60 * 30, // 30 минут по умолчанию
        },
        name: process.env.SESSION,
    }),
);

// for local use
app.use((req, res, next) => {
    console.log('COOKIE _csrf:', req.cookies._csrf);
    console.log('HEADER X-CSRF-Token:', req.get('X-CSRF-Token'));
    next();
});
// // for local use

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
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next(err);
});

app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});

app.use(useragent.express());
// 🔒 Middleware проверки IP/UA
app.use((req, res, next) => {
    console.log('Сессия:', req.session);
    if (req.session.user) {
        const currentIp = (req.headers['x-forwarded-for'] || req.ip || '')
            .toString()
            .split(',')[0]
            .trim();
        const currentUA = req.headers['user-agent'];

        const storedIp = req.session.ip;
        const storedUA = req.session.ua;

        if (!storedIp || !storedUA) {
            req.session.ip = currentIp;
            req.session.ua = currentUA;
        } else if (storedIp !== currentIp || storedUA !== currentUA) {
            logAction(
                req,
                '⚠️ Подозрительная активность: IP или UA изменены',
                'server.js',
            );
            console.warn('⚠️ Подозрительная активность: IP или UA изменены');
            req.session.destroy(() => {
                res.clearCookie(process.env.SESSION);
                return res
                    .status(401)
                    .json({ error: 'Сессия недействительна' });
            });
            return;
        }
    }
    next();
});

// Подключаем роуты
app.use('/api/', checkWork);
app.use('/api/yandex/', yandexRoutes);
app.use('/api/check-session', authCheck);

app.use('/api/users/', checkSession(), usersRoutes);
app.use('/api/gallery', checkSession(), galleryRoutes);
app.use('/api/gallery', checkSession(), galleryEditRoutes);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(3000, () => {
    console.log('HTTP сервер запущен на http://localhost:3000');
});
