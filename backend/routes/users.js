import express from 'express'
import pool from '../db.js'

const router = express.Router()

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users')
        res.json(rows)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Failed to fetch users' })
    }
})

router.post('/', async (req, res) => {
    let { username, email, phone, role } = req.body

    if (!username || !email || !phone) {
        return res.status(400).json({ error: 'Username, email и phone обязательны' })
    }

    if (typeof username !== 'string' || typeof phone !== 'string') {
        return res.status(400).json({ error: 'Некорректные данные' })
    }

    if (!Array.isArray(email)) {
        return res.status(400).json({ error: 'Email должен быть массивом' });
    }
    email = email.map(e => typeof e === 'string' ? e.trim() : '');

    username = username.trim()
    phone = phone.trim()

    if (username.length < 3) {
        return res.status(400).json({ error: 'Username должен быть не короче 3 символов' })
    }
    if (/\d/.test(username)) {
        return res.status(400).json({ error: 'Username не должен содержать цифры' })
    }

    const emailRegex = /^[a-zA-Z0-9._-]+@(yandex\.ru|gmail\.com)$/
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Email должен быть с доменом @gmail.com или @yandex.ru' })
    }

    const phoneRegex = /^\+?\d{7,15}$/
    if (!phoneRegex.test(phone)) {
        return res.status(400).json({ error: 'Некорректный формат телефона' })
    }

    try {
        const { rows } = await pool.query(
            'INSERT INTO users (username, email, phone, role) VALUES ($1, $2, $3, $4) RETURNING *',
            [username, email, phone, role || 'user']
        )
        res.json(rows[0])
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Failed to create user' })
    }
})

// Удаление пользователя по id
router.delete('/:id', async (req, res) => {
    const id = req.params.id
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id])
        res.json({ message: 'User deleted' })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Failed to delete user' })
    }
})

// Обновление пользователя по id
router.put('/:id', async (req, res) => {
    const id = req.params.id
    const { username, email, role, phone } = req.body
    try {
        const { rows } = await pool.query(
            'UPDATE users SET username = COALESCE($1, username), email = COALESCE($2, email), role = COALESCE($3, role), phone = COALESCE($4, phone) WHERE id = $5 RETURNING *',
            [username, email, role, phone, id]
        )
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' })
        res.json(rows[0])
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Failed to update user' })
    }
})


export default router