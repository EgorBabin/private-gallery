import express from 'express';
import pool from '../db.js';

const router = express.Router();

function normalizeUser(row) {
    if (!row) {
        return row;
    }
    const { telegramid, ...rest } = row;
    return { ...rest, telegramID: telegramid ?? null };
}

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users');
        res.json(rows.map(normalizeUser));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

router.post('/', async (req, res) => {
    let { username, email, telegramID, role } = req.body;

    if (!username || !email || !telegramID) {
        return res
            .status(400)
            .json({ error: 'Username, email и ID обязательны' });
    }

    if (typeof username !== 'string' || typeof telegramID !== 'string') {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    if (!Array.isArray(email)) {
        return res.status(400).json({ error: 'Email должен быть массивом' });
    }
    email = email.map((e) => (typeof e === 'string' ? e.trim() : ''));

    username = username.trim();
    telegramID = telegramID.trim();

    if (username.length < 3) {
        return res
            .status(400)
            .json({ error: 'Username должен быть не короче 3 символов' });
    }
    if (/\d/.test(username)) {
        return res
            .status(400)
            .json({ error: 'Username не должен содержать цифры' });
    }

    const emailRegex = /^[a-zA-Z0-9._-]+@(yandex\.ru|gmail\.com)$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            error: 'Email должен быть с доменом @yandex.ru',
        });
    }

    const telegramIDRegex = /^\d+$/;
    if (!telegramIDRegex.test(telegramID)) {
        return res
            .status(400)
            .json({ error: 'Некорректный формат ID telegram' });
    }

    try {
        const { rows } = await pool.query(
            'INSERT INTO users (username, email, telegramID, role) VALUES ($1, $2, $3, $4) RETURNING *',
            [username, email, telegramID, role || 'user'],
        );
        res.json(normalizeUser(rows[0]));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Удаление пользователя по id
router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ message: 'User deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Обновление пользователя по id
router.put('/:id', async (req, res) => {
    const id = req.params.id;
    const { username, email, role, telegramID } = req.body;
    try {
        const { rows } = await pool.query(
            'UPDATE users SET username = COALESCE($1, username), email = COALESCE($2, email), role = COALESCE($3, role), telegramID = COALESCE($4, telegramID) WHERE id = $5 RETURNING *',
            [username, email, role, telegramID, id],
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(normalizeUser(rows[0]));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

export default router;
