import pool from '../db.js';

// Размеры preview (а значит и пропорции медиа) по ETag файла: ETag не меняется
// при reorder/soft delete (CopyObject того же содержимого), поэтому
// переименования ключей не требуют обновлять таблицу.

let ensureTablePromise = null;

function ensureTable() {
    if (!ensureTablePromise) {
        ensureTablePromise = pool
            .query(
                `CREATE TABLE IF NOT EXISTS public.media_dimensions (
                    etag text PRIMARY KEY,
                    width integer NOT NULL CHECK (width > 0),
                    height integer NOT NULL CHECK (height > 0)
                )`,
            )
            .catch((err) => {
                ensureTablePromise = null;
                throw err;
            });
    }
    return ensureTablePromise;
}

/** @returns {Promise<Map<string, {width: number, height: number}>>} */
export async function getDimensionsByEtags(etags) {
    const unique = [...new Set((etags || []).filter(Boolean))];
    const result = new Map();
    if (unique.length === 0) {
        return result;
    }

    await ensureTable();
    const { rows } = await pool.query(
        'SELECT etag, width, height FROM public.media_dimensions WHERE etag = ANY($1)',
        [unique],
    );
    for (const row of rows) {
        result.set(row.etag, { width: row.width, height: row.height });
    }
    return result;
}

export async function saveDimensions(etag, width, height) {
    const w = Number(width);
    const h = Number(height);
    if (
        !etag ||
        !Number.isInteger(w) ||
        !Number.isInteger(h) ||
        w <= 0 ||
        h <= 0
    ) {
        return;
    }

    await ensureTable();
    await pool.query(
        `INSERT INTO public.media_dimensions (etag, width, height)
         VALUES ($1, $2, $3)
         ON CONFLICT (etag) DO UPDATE SET width = EXCLUDED.width, height = EXCLUDED.height`,
        [etag, w, h],
    );
}
