import pool from '../db.js';

// Поиск пользователя по email из массива users.email (общий для входа через
// Google и Яндекс).

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Приводит email к виду для сравнения: нижний регистр, а для Gmail ещё и
 * без точек и "+метки" в имени — Gmail считает john.doe и johndoe+x одним
 * ящиком, поэтому админу не нужно угадывать, как именно записан адрес.
 */
export function normalizeEmailForMatch(email) {
    const lower = String(email || '')
        .trim()
        .toLowerCase();
    const at = lower.lastIndexOf('@');
    if (at < 1) {
        return lower;
    }
    let local = lower.slice(0, at);
    let domain = lower.slice(at + 1);
    if (GMAIL_DOMAINS.has(domain)) {
        domain = 'gmail.com';
        local = local.split('+')[0].replace(/\./g, '');
    }
    return `${local}@${domain}`;
}

export function isGmailAddress(email) {
    const domain = String(email || '')
        .trim()
        .toLowerCase()
        .split('@')[1];
    return GMAIL_DOMAINS.has(domain);
}

/** Отметка успешного входа для страницы статистики. */
export function recordLogin(userId, method) {
    pool.query(
        'UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP, last_login_method = $2 WHERE id = $1',
        [Number(userId), method],
    ).catch((err) => {
        console.error('Failed to record login:', err.message);
    });
}

/** @returns {Promise<object|null>} строка users или null */
export async function findUserByEmail(email) {
    const target = normalizeEmailForMatch(email);
    if (!target.includes('@')) {
        return null;
    }
    // пользователей единицы, поэтому сравнение с нормализацией делаем в коде
    const { rows } = await pool.query(
        'SELECT id, username, email, role, is_active FROM users',
    );
    return (
        rows.find((row) =>
            (Array.isArray(row.email) ? row.email : [row.email]).some(
                (item) => normalizeEmailForMatch(item) === target,
            ),
        ) || null
    );
}
