import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import cors from 'cors' // for local use
import useragent from 'express-useragent'

import checkWork from './routes/hello.js'
import usersRoutes from './routes/users.js'
import yandexRoutes from './routes/yandex.js'
import authCheck from './utils/authCheck.js';
import { logAction } from './utils/logger.js'

const app = express()
const PORT = 3000

// for local use
app.use(cors({
    origin: 'http://localhost:5173', // фронт
    credentials: true // чтобы работали cookies
}))
// // for local use

app.use(express.json())
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,          
        secure: false, // в проде — true // for local use
        sameSite: 'lax',
        maxAge: 1000 * 60 * 30 // 30 минут по умолчанию
    }
}))

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

app.use(useragent.express())

// Подключаем роуты
app.use(checkWork)
app.use('/api/users', usersRoutes)
app.use('/', yandexRoutes)
app.use(authCheck);

app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Internal Server Error' })
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
