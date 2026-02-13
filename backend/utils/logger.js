import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import useragent from 'express-useragent';

// роутер
// await logAction(req, 'Создание чего-то важного', { someId: 123 })
// логика
// res.json({ ok: true })

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(__dirname, '../logs/activity.log');

const TELEGRAM_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const AUTH_ROUTE_RE = /^\/api\/(?:yandex|telegram)(?:\/|$)/i;
const SENSITIVE_QUERY_KEYS = new Set([
    'code',
    'state',
    'hash',
    'auth_date',
    'access_token',
    'refresh_token',
    'id_token',
    'token',
]);

// Создаём папку, если не существует
if (!fs.existsSync(path.dirname(logPath))) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
}

function getDeviceType(req) {
    const source = req.headers['user-agent'];
    const ua = useragent.parse(source);
    return ua.isMobile ? 'Mobile' : 'PC';
}

async function sendToTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        return;
    }

    try {
        await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML',
                }),
            },
        );
    } catch (err) {
        console.error('Ошибка отправки в Telegram:', err);
    }
}

function escapeTelegramHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sanitizeOriginalUrl(rawUrl) {
    const raw = String(rawUrl ?? '');
    const [pathnameRaw, query = ''] = raw.split('?', 2);
    const pathname = pathnameRaw || '/';

    if (!query) {
        return pathname;
    }

    const params = new URLSearchParams(query);
    if (!params.size) {
        return pathname;
    }

    const sanitizedParams = new URLSearchParams();
    for (const [key, value] of params.entries()) {
        const normalizedKey = String(key).toLowerCase();
        if (SENSITIVE_QUERY_KEYS.has(normalizedKey)) {
            sanitizedParams.append(key, '[REDACTED]');
            continue;
        }
        sanitizedParams.append(key, value);
    }

    return `${pathname}?${sanitizedParams.toString()}`;
}

function shouldSendUrlToTelegram(pathname) {
    return !AUTH_ROUTE_RE.test(String(pathname || ''));
}

export async function logAction(req, action, extra = {}) {
    const timestamp = new Date().toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
    });
    const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        req.ip ||
        'unknown';
    const cleanPath = String(req.originalUrl || '').split('?', 1)[0] || '/';
    const sanitizedUrl = sanitizeOriginalUrl(req.originalUrl);
    const method = req.method;
    const device = getDeviceType(req);

    const user = req.session?.user || {};
    const email = user.email || 'anonymous';
    const authType = user.authType || 'unknown';

    const extraData =
        extra && Object.keys(extra).length
            ? ` | Extra: ${JSON.stringify(extra)}`
            : '';
    const logEntry = `[${timestamp}] IP: ${ip} | ${method} ${sanitizedUrl} | ${device} | Email: ${email} | Auth: ${authType} | Action: ${action}${extra && Object.keys(extra).length ? ` | Extra: ${JSON.stringify(extra)}` : ''}\n`;

    fs.appendFile(logPath, logEntry, (err) => {
        if (err) {
            console.error('Ошибка записи лога:', err);
        }
    });

    const lines = [
        `<b>${escapeTelegramHtml(action)}</b>`,
        `<b>Email:</b> ${escapeTelegramHtml(email)}`,
        `<b>Device:</b> ${escapeTelegramHtml(device)}`,
        `<b>Time:</b> ${escapeTelegramHtml(timestamp)}`,
        `<b>IP:</b> ${escapeTelegramHtml(ip)}`,
        `<b>Auth:</b> ${escapeTelegramHtml(authType)}`,
        `${extraData ? `📎 ${escapeTelegramHtml(extraData)}` : ''}`,
    ];

    if (shouldSendUrlToTelegram(cleanPath)) {
        const frontendUrl = String(process.env.FRONTEND_URL || '');
        lines.splice(
            5,
            0,
            `<b>URL:</b> ${escapeTelegramHtml(`${method} ${frontendUrl}${sanitizedUrl}`)}`,
        );
    }

    const tgMessage = lines.join('\n');
    await sendToTelegram(tgMessage);
}
