import pool from '../db.js';

// Миграции для уже работающих баз: db/init выполняется только при первом
// создании базы, поэтому новые таблицы и колонки добавляются здесь.
// Все команды идемпотентны.
const MIGRATIONS = [
    // когда и как пользователь входил и когда был активен (страница статистики)
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz',
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_method text',
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz',
    // журнал действий для страницы «Журнал»; user_id без внешнего ключа,
    // чтобы записи об удалённых пользователях сохранялись
    `CREATE TABLE IF NOT EXISTS public.audit_log (
        id bigserial PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        category text NOT NULL,
        outcome text,
        action text NOT NULL,
        details text,
        meta jsonb,
        user_id integer,
        email text,
        ip text,
        device text,
        method text,
        path text
    )`,
    'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log (created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_user ON public.audit_log (user_id, created_at DESC)',
];

let schemaPromise = null;

// backend и worker стартуют одновременно: параллельный CREATE ... IF NOT EXISTS
// в Postgres может упасть на конфликте имён, тогда просто повторяем
const CONCURRENT_DDL_CODES = new Set(['23505', '42P07', '42701', '40P01']);

async function runMigration(sql) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            await pool.query(sql);
            return;
        } catch (err) {
            if (attempt >= 3 || !CONCURRENT_DDL_CODES.has(err.code)) {
                throw err;
            }
            await new Promise((resolve) => {
                setTimeout(resolve, 300 * attempt);
            });
        }
    }
}

export function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            for (const sql of MIGRATIONS) {
                await runMigration(sql);
            }
        })().catch((err) => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
}
