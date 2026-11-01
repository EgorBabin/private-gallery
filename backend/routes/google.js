import express from 'express';
import crypto from 'crypto';
import { logAction } from '../utils/logger.js';
import {
    findUserByEmail,
    isGmailAddress,
    recordLogin,
} from '../utils/userLookup.js';

// Вход через Google (OpenID Connect, authorization code + PKCE).
// Приватность:
// - запрашивается только scope "openid email": без имени, фото и доступа к
//   данным аккаунта; токены Google нигде не сохраняются;
// - на странице нет скриптов Google, только переход на accounts.google.com;
// - state, nonce и PKCE защищают от подмены и повторного использования ответа.

const router = express.Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set([
    'https://accounts.google.com',
    'accounts.google.com',
]);
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;
const REMEMBER_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

// ошибки входа показываем на странице логина, а не сырым JSON
function redirectToLoginError(res, code) {
    const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return res.redirect(`${base}/login?error=${code}`);
}

function randomToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function decodeJwtPayload(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        throw new Error('Malformed id_token');
    }
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/**
 * id_token получен напрямую от Google по TLS в обмен на code, поэтому
 * подпись можно не проверять (OpenID Connect Core 3.1.3.7), но все claims
 * проверяются: издатель, получатель, срок, nonce и подтверждённость email.
 */
function validateIdTokenClaims(claims, { clientId, nonce }) {
    const now = Math.floor(Date.now() / 1000);
    if (!GOOGLE_ISSUERS.has(claims.iss)) {
        throw new Error(`Unexpected issuer: ${claims.iss}`);
    }
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(clientId)) {
        throw new Error('id_token audience mismatch');
    }
    if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_SEC < now) {
        throw new Error('id_token expired');
    }
    if (!nonce || claims.nonce !== nonce) {
        throw new Error('id_token nonce mismatch');
    }
    if (claims.email_verified !== true || typeof claims.email !== 'string') {
        throw new Error('Google email is missing or not verified');
    }
}

/**
 * Google отвечает за адрес, только если это Gmail или домен Google Workspace
 * (claim hd). Аккаунт Google, созданный на чужую почту (например
 * name@yandex.ru), не доказывает владение этим ящиком сейчас, поэтому такой
 * вход не принимаем: для таких адресов есть вход через их почтовый сервис.
 */
function isGoogleAuthoritative(claims) {
    const email = claims.email.trim().toLowerCase();
    if (isGmailAddress(email)) {
        return true;
    }
    const hd = String(claims.hd || '').toLowerCase();
    return Boolean(hd) && email.endsWith(`@${hd}`);
}

router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
        console.error('Google login is not configured (GOOGLE_* env)');
        return redirectToLoginError(res, 'failed');
    }

    logAction(req, '👁️‍🗨️ Google', '', { notify: false });
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

    req.session.googleAuthState = {
        value: state,
        nonce,
        codeVerifier,
        remember: req.query.remember === '1' ? '1' : '0',
        createdAt: Date.now(),
    };

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');

    req.session.save((err) => {
        if (err) {
            console.error('Failed to persist google oauth state:', err);
            return redirectToLoginError(res, 'failed');
        }
        return res.redirect(url.toString());
    });
});

router.get('/callback', async (req, res) => {
    if (req.session.user) {
        return res.redirect(process.env.FRONTEND_URL);
    }

    const { code, state } = req.query;
    const saved = req.session?.googleAuthState;
    req.session.googleAuthState = null;

    const isStateValid =
        typeof state === 'string' &&
        typeof saved?.value === 'string' &&
        state === saved.value &&
        Date.now() - Number(saved.createdAt || 0) <= OAUTH_STATE_MAX_AGE_MS;

    // ?error=access_denied — пользователь отменил вход на стороне Google
    if (typeof code !== 'string' || !code || !isStateValid) {
        logAction(req, '⚠️ Невалидный OAuth callback (code/state)', 'Google');
        return redirectToLoginError(res, 'failed');
    }

    try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: process.env.GOOGLE_REDIRECT_URI,
                code_verifier: saved.codeVerifier,
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (!tokenRes.ok) {
            throw new Error(
                `Google token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`,
            );
        }

        const tokenData = await tokenRes.json();
        const claims = decodeJwtPayload(tokenData.id_token);
        validateIdTokenClaims(claims, {
            clientId: process.env.GOOGLE_CLIENT_ID,
            nonce: saved.nonce,
        });

        const email = claims.email.trim().toLowerCase();
        if (!isGoogleAuthoritative(claims)) {
            logAction(req, '❌ Google не подтверждает этот адрес', email);
            return redirectToLoginError(res, 'not_found');
        }

        const user = await findUserByEmail(email);
        if (!user) {
            logAction(req, '❌ Пользователь не найден', email);
            return redirectToLoginError(res, 'not_found');
        }
        if (user.is_active === false) {
            logAction(req, '❌ Пользователь отключён', email);
            return redirectToLoginError(res, 'not_found');
        }

        req.session.regenerate((err) => {
            if (err) {
                console.error('Ошибка сессии:', err);
                return redirectToLoginError(res, 'failed');
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                email,
                authType: 'google',
                role: user.role || 'user',
            };
            req.session.ip =
                req.headers['x-forwarded-for']?.split(',')[0] ||
                req.socket.remoteAddress;
            req.session.ua = req.headers['user-agent'];

            if (saved.remember === '1') {
                req.session.cookie.maxAge = REMEMBER_MAX_AGE_MS;
            } else {
                req.session.cookie.expires = false;
            }

            recordLogin(user.id, 'google');
            logAction(req, '✅ Пользователь авторизовался через Google');
            return res.redirect(process.env.FRONTEND_URL);
        });
    } catch (err) {
        console.error(err.message);
        logAction(req, '❌ Ошибка авторизации через Google');
        redirectToLoginError(res, 'failed');
    }
});

export default router;
