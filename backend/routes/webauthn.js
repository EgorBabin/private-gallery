import express from 'express';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import crypto from 'crypto';
import base64url from 'base64url';
import pool from '../db.js';

const router = express.Router();

const rpName = process.env.WEBAUTHN_RP_NAME;
const rpID = process.env.WEBAUTHN_RP_ID;
const origin = process.env.WEBAUTHN_ORIGIN;

router.post('/register/options', async (req, res) => {
    const { inviteSessionToken, username } = req.body;
    if (!inviteSessionToken || !username) {
        return res.status(400).json({ error: 'missing' });
    }

    const tokenHash = crypto
        .createHmac('sha256', process.env.INVITE_SECRET)
        .update(inviteSessionToken)
        .digest('hex');
    const q = await pool.query(
        `SELECT id, expires_at FROM invite_sessions WHERE token_hash=$1`,
        [tokenHash],
    );
    if (q.rowCount === 0 || new Date(q.rows[0].expires_at) < new Date()) {
        return res.status(400).json({ error: 'invalid session' });
    }

    const userId = base64url(crypto.randomBytes(16));
    const options = generateRegistrationOptions({
        rpName,
        rpID,
        userID: userId,
        userName: username,
        attestationType: 'none',
        authenticatorSelection: {
            userVerification: 'preferred',
        },
    });

    await pool.query(`UPDATE invite_sessions SET challenge=$1 WHERE id=$2`, [
        options.challenge,
        q.rows[0].id,
    ]);

    res.json(options);
});

router.post('/register/verify', async (req, res) => {
    const { inviteSessionToken, attestationResponse, username } = req.body;
    if (!inviteSessionToken || !attestationResponse || !username) {
        return res.status(400).json({ error: 'missing' });
    }

    const tokenHash = crypto
        .createHmac('sha256', process.env.INVITE_SECRET)
        .update(inviteSessionToken)
        .digest('hex');
    const q = await pool.query(
        `SELECT id, challenge FROM invite_sessions WHERE token_hash=$1`,
        [tokenHash],
    );
    if (q.rowCount === 0 || new Date(q.rows[0].expires_at) < new Date()) {
        return res.status(400).json({ error: 'invalid session' });
    }

    const expectedChallenge = q.rows[0].challenge;

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            credential: attestationResponse,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
        });
    } catch (err) {
        return res
            .status(400)
            .json({ error: 'verification failed', details: err.message });
    }

    if (!verification.verified) {
        return res.status(400).json({ error: 'not verified' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userInsert = await client.query(
            `INSERT INTO users (username, email) VALUES ($1,$2) RETURNING id`,
            [username, null],
        );
        const userId = userInsert.rows[0].id;

        const cred = verification.registrationInfo;
        await client.query(
            `INSERT INTO credentials (user_id, credential_id, public_key, fmt, sign_count) VALUES ($1,$2,$3,$4,$5)`,
            [
                userId,
                Buffer.from(cred.credentialPublicKey, 'base64'),
                cred.credentialPublicKey,
                cred.fmt,
                cred.counter || 0,
            ],
        );

        await client.query(`DELETE FROM invite_sessions WHERE id = $1`, [
            q.rows[0].id,
        ]);

        await client.query('COMMIT');
        req.session.userId = userId;
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
});

export default router;
