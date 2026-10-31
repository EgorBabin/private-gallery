import useragent from 'express-useragent';

// роутер
// logAction(req, 'Создание чего-то важного', { someId: 123 })
// logAction(req, 'Шумное событие', '', { notify: false }) // только stdout
// логика
// res.json({ ok: true })
//
// Журнал пишется в stdout (Docker ротирует его сам, см. docker-compose.yaml),
// в Telegram уходят только важные события с ограничением частоты.

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

// Telegram пропускает в группу ~20 сообщений в минуту, поэтому шлём
// не чаще одного раза в TELEGRAM_MIN_INTERVAL_MS и держим ограниченную очередь.
const TELEGRAM_MIN_INTERVAL_MS = 3100;
const TELEGRAM_QUEUE_LIMIT = 30;
const TELEGRAM_TIMEOUT_MS = 5000;

const telegramQueue = [];
let telegramDropped = 0;
let telegramPumping = false;

function getDeviceType(req) {
    const source = req.headers['user-agent'];
    const ua = useragent.parse(source);
    return ua.isMobile ? 'Mobile' : 'PC';
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function postToTelegram(message) {
    const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
            }),
            signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        },
    );

    if (res.ok) {
        return 0;
    }

    const body = await res.json().catch(() => null);
    const retryAfterSec = Number(body?.parameters?.retry_after) || 0;
    console.error('Telegram отклонил сообщение:', res.status, body?.description);
    return retryAfterSec * 1000;
}

async function pumpTelegramQueue() {
    if (telegramPumping) {
        return;
    }
    telegramPumping = true;

    try {
        while (telegramQueue.length > 0) {
            let message = telegramQueue.shift();
            if (telegramDropped > 0) {
                message += `\n\n<i>Пропущено уведомлений: ${telegramDropped}</i>`;
                telegramDropped = 0;
            }

            let pauseMs = TELEGRAM_MIN_INTERVAL_MS;
            try {
                pauseMs = Math.max(pauseMs, await postToTelegram(message));
            } catch (err) {
                console.error('Ошибка отправки в Telegram:', err.message);
            }
            await sleep(pauseMs);
        }
    } finally {
        telegramPumping = false;
    }
}

function sendToTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        return;
    }

    if (telegramQueue.length >= TELEGRAM_QUEUE_LIMIT) {
        telegramDropped += 1;
        return;
    }

    telegramQueue.push(message);
    void pumpTelegramQueue();
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

export function logAction(req, action, extra = {}, { notify = true } = {}) {
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
    const logEntry = `[activity] [${timestamp}] IP: ${ip} | ${method} ${sanitizedUrl} | ${device} | Email: ${email} | Auth: ${authType} | Action: ${action}${extraData}`;

    console.log(logEntry);

    if (!notify) {
        return;
    }

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
    sendToTelegram(tgMessage);
}
