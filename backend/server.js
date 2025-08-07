import 'dotenv/config'
import express from 'express'
import session from 'express-session'

import https from 'https'
import fs from 'fs'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'

import cookieParser from 'cookie-parser'
import csurf from 'csurf'

import pgSession from 'connect-pg-simple'
import pool from './db.js'
import cors from 'cors' // for local use
import useragent from 'express-useragent'

import checkWork from './routes/hello.js'
import usersRoutes from './routes/users.js'
import yandexRoutes from './routes/yandex.js'
import authCheck from './utils/authCheck.js';
import { logAction } from './utils/logger.js'

const app = express()

app.use(helmet())

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 500,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	ipv6Subnet: 56,
})

app.use(limiter)

app.use(cookieParser())

const httpsServer = https.createServer({
    key: fs.readFileSync('../SSL/key.pem'),
    cert: fs.readFileSync('../SSL/cert.pem'),
}, app);

// for local use
app.use(cors({
    origin: process.env.FRONTEND_URL, // фронт
    credentials: true // чтобы работали cookies
}))
// // for local use

app.use(express.json())

const PgSession = pgSession(session)
app.use(session({
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
        maxAge: 1000 * 60 * 30 // 30 минут по умолчанию
    }
}))

app.use(csurf({ cookie: true }))
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'Invalid CSRF token' })
    }
    next(err)
})

app.use(useragent.express())
// 🔒 Middleware проверки IP/UA
app.use(async (req, res, next) => {
    console.log('Сессия:', req.session);
    if (req.session.user) {
        const currentIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const currentUA = req.headers['user-agent'];

        const storedIp = req.session.ip;
        const storedUA = req.session.ua;

        if (!storedIp || !storedUA) {
            req.session.ip = currentIp;
            req.session.ua = currentUA;
        } else if (storedIp !== currentIp || storedUA !== currentUA) {
            await logAction(req, '⚠️ Подозрительная активность: IP или UA изменены', 'server.js' )
            console.warn('⚠️ Подозрительная активность: IP или UA изменены');
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
                return res.status(401).json({ error: 'Сессия недействительна' });
            });
            return;
        }
    }
    next();
});

// Подключаем роуты
app.use('/api/', checkWork)
app.use('/api/users/', usersRoutes)
app.use('/api/yandex/', yandexRoutes)
app.use('/api/check-session/', authCheck);

app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Internal Server Error' })
})

httpsServer.listen(3000, () => {
    console.log('HTTPS сервер запущен на https://localhost:3000');
});