import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import cors from 'cors' // for local use
import usersRoutes from './routes/users.js'
import yandexRoutes from './routes/yandex.js'
import useragent from 'express-useragent'

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
  cookie: { secure: false } // for local use - сменить на true
}))

app.use(useragent.express())

// check work
app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello from backend!' })
})

// Подключаем роуты
app.use('/api/users', usersRoutes)
app.use('/api', yandexRoutes)

app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Internal Server Error' })
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
