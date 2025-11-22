import express from 'express';
import crypto from 'crypto';
import pool from '../db.js'; // адаптируй под свой db-клиент
import checkSession from '../utils/checkSession.js';

const router = express.Router();

function genCode() {
    return crypto.randomBytes(18).toString('base64url');
}
function hashCode(code) {
    return crypto
        .createHmac('sha256', process.env.INVITE_SECRET)
        .update(code)
        .digest('hex');
}

router.post('/', checkSession(), async (req, res) => {
    // create invite (auth required)
    const createdBy = req.session.userId; // подстрой под свою сессию
    const plain = genCode();
    const codeHash = hashCode(plain);
    const expiresAt = new Date(
        Date.now() +
            parseInt(process.env.INVITE_EXPIRATION_MINUTES || 60) * 60000,
    );
    await pool.query(
        `INSERT INTO invite_codes (code_hash, created_by, expires_at) VALUES ($1,$2,$3)`,
        [codeHash, createdBy, expiresAt],
    );
    // return plain code to creator (show once)
    res.json({ code: plain, expiresAt });
});

router.post('/consume', async (req, res) => {
    // body: { code }
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'code required' });
    }
    const codeHash = hashCode(code);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const q = await client.query(
            `SELECT id, used, expires_at FROM invite_codes WHERE code_hash=$1 FOR UPDATE`,
            [codeHash],
        );
        if (q.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'invalid code' });
        }
        const row = q.rows[0];
        if (row.used) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'already used' });
        }
        if (new Date(row.expires_at) < new Date()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'expired' });
        }

        // mark used
        await client.query(
            `UPDATE invite_codes SET used = true, used_at = now() WHERE id = $1`,
            [row.id],
        );

        // create invite_session token (short-lived)
        const token = crypto.randomBytes(24).toString('hex');
        const tokenHash = crypto
            .createHmac('sha256', process.env.INVITE_SECRET)
            .update(token)
            .digest('hex');
        const expiresAt = new Date(
            Date.now() +
                parseInt(process.env.INVITE_SESSION_TTL_MIN || 15) * 60000,
        );
        const insert = await client.query(
            `INSERT INTO invite_sessions (invite_id, token_hash, expires_at) VALUES ($1,$2,$3) RETURNING id`,
            [row.id, tokenHash, expiresAt],
        );
        await client.query('COMMIT');

        // return plain token to consumer (use for webauthn flow)
        res.json({ inviteSessionToken: token, expiresAt });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
});

export default router;
