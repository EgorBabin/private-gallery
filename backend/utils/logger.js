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
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

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

export async function logAction(req, action, extra = {}) {
    const timestamp = new Date().toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
    });
    const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        req.ip ||
        'unknown';
    const url = req.originalUrl;
    const method = req.method;
    const device = getDeviceType(req);

    const user = req.session?.user || {};
    const email = user.email || 'anonymous';
    const authType = user.authType || 'unknown';

    const extraData =
        extra && Object.keys(extra).length
            ? ` | Extra: ${JSON.stringify(extra)}`
            : '';
    const logEntry = `[${timestamp}] IP: ${ip} | ${method} ${url} | ${device} | Email: ${email} | Auth: ${authType} | Action: ${action}${extra && Object.keys(extra).length ? ` | Extra: ${JSON.stringify(extra)}` : ''}\n`;

    fs.appendFile(logPath, logEntry, (err) => {
        if (err) console.error('Ошибка записи лога:', err);
    });

    const lines = [
        `<b>${action}</b>`,
        `<b>Email:</b> ${email}`,
        `<b>Device:</b> ${device}`,
        `<b>Time:</b> ${timestamp}`,
        `<b>IP:</b> ${ip}`,
        `<b>URL:</b> ${method}`,
        `${process.env.FRONTEND_URL}${url}`,
        `<b>${authType}</b>`,
        `${extraData ? `📎 ${extraData}` : ''}`,
    ];

    const tgMessage = lines.join('\n');
    await sendToTelegram(tgMessage);
}
