import pool from '../db.js';

const CARD_PATH_RE = /^(\d{1,4})\/([a-zA-Z]+)$/;

function mapCardRow(row) {
    if (!row) {
        return null;
    }

    return {
        id: Number(row.id),
        path: row.path,
        year: Number(row.year),
        title: row.title,
        imageCount: Number(row.image_count) || 0,
        sortOrder: Number(row.sort_order) || 0,
        previewKey: row.preview_key || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function normalizeCardId(id) {
    const parsed = Number(id);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('Invalid card id');
    }
    return parsed;
}

function normalizeCardTitle(title) {
    const value = String(title ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    if (!value) {
        throw new Error('Card title is required');
    }
    return value;
}

function normalizeYear(year, fallbackYear) {
    const candidate = year ?? fallbackYear;
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
        throw new Error('Invalid year');
    }
    return parsed;
}

function normalizeSortOrder(sortOrder, fallbackSortOrder = null) {
    if (
        sortOrder === undefined ||
        sortOrder === null ||
        String(sortOrder).trim() === ''
    ) {
        return fallbackSortOrder;
    }
    const parsed = Number(sortOrder);
    if (!Number.isInteger(parsed)) {
        throw new Error('sortOrder must be integer');
    }
    return parsed;
}

function normalizeImageCount(imageCount, fallback = 0) {
    const candidate = imageCount ?? fallback;
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('imageCount must be non-negative integer');
    }
    return parsed;
}

export function normalizeCardPath(rawPath) {
    return String(rawPath ?? '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/\.\./g, '')
        .replace(/\/{2,}/g, '/');
}

export function parseCardPath(rawPath) {
    const normalizedPath = normalizeCardPath(rawPath);
    const match = normalizedPath.match(CARD_PATH_RE);
    if (!match) {
        return null;
    }

    const yearPart = match[1];
    const category = match[2].toLowerCase();

    return {
        path: `${yearPart}/${category}`,
        year: Number(yearPart),
        category,
    };
}

export function normalizePreviewKey(rawPreviewKey) {
    if (rawPreviewKey === undefined || rawPreviewKey === null) {
        return null;
    }

    const value = String(rawPreviewKey).trim().replace(/^\/+/, '');
    return value || null;
}

function cardSelectSQL() {
    return `
        SELECT
            id,
            path,
            year,
            title,
            image_count,
            sort_order,
            preview_key,
            created_at,
            updated_at
        FROM cards
    `;
}

export async function listCards() {
    const { rows } = await pool.query(
        `${cardSelectSQL()} ORDER BY sort_order DESC, year DESC, id DESC`,
    );
    return rows.map(mapCardRow);
}

export async function getCardById(id) {
    const cardId = normalizeCardId(id);
    const { rows } = await pool.query(
        `${cardSelectSQL()} WHERE id = $1 LIMIT 1`,
        [cardId],
    );
    return mapCardRow(rows[0]);
}

export async function getCardByPath(path) {
    const parsed = parseCardPath(path);
    if (!parsed) {
        return null;
    }
    const { rows } = await pool.query(
        `${cardSelectSQL()} WHERE path = $1 LIMIT 1`,
        [parsed.path],
    );
    return mapCardRow(rows[0]);
}

export async function createCard(input = {}) {
    const parsedPath = parseCardPath(input.path);
    if (!parsedPath) {
        throw new Error('Invalid path format. Use "year/category"');
    }

    const title = normalizeCardTitle(input.title);
    const year = normalizeYear(input.year, parsedPath.year);
    if (year !== parsedPath.year) {
        throw new Error('Year must match path year');
    }

    const imageCount = normalizeImageCount(input.imageCount, 0);
    const previewKey = normalizePreviewKey(input.previewKey);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let sortOrder = normalizeSortOrder(input.sortOrder, null);
        if (sortOrder === null) {
            const { rows } = await client.query(
                'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM cards',
            );
            sortOrder = Number(rows[0]?.next_order ?? 0);
        }

        const { rows } = await client.query(
            `
                INSERT INTO cards (path, year, title, image_count, sort_order, preview_key)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING
                    id,
                    path,
                    year,
                    title,
                    image_count,
                    sort_order,
                    preview_key,
                    created_at,
                    updated_at
            `,
            [parsedPath.path, year, title, imageCount, sortOrder, previewKey],
        );

        await client.query('COMMIT');
        return mapCardRow(rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function updateCard(id, patch = {}) {
    const current = await getCardById(id);
    if (!current) {
        return null;
    }

    const nextPathRaw = patch.path !== undefined ? patch.path : current.path;
    const parsedPath = parseCardPath(nextPathRaw);
    if (!parsedPath) {
        throw new Error('Invalid path format. Use "year/category"');
    }

    const year = normalizeYear(
        patch.year !== undefined ? patch.year : current.year,
        parsedPath.year,
    );
    if (year !== parsedPath.year) {
        throw new Error('Year must match path year');
    }

    const title = normalizeCardTitle(
        patch.title !== undefined ? patch.title : current.title,
    );
    const sortOrder = normalizeSortOrder(
        patch.sortOrder,
        Number(current.sortOrder),
    );
    const imageCount = normalizeImageCount(
        patch.imageCount,
        current.imageCount,
    );

    const previewKey =
        patch.previewKey !== undefined
            ? normalizePreviewKey(patch.previewKey)
            : current.previewKey;

    const cardId = normalizeCardId(id);
    const { rows } = await pool.query(
        `
            UPDATE cards
            SET
                path = $1,
                year = $2,
                title = $3,
                image_count = $4,
                sort_order = $5,
                preview_key = $6,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING
                id,
                path,
                year,
                title,
                image_count,
                sort_order,
                preview_key,
                created_at,
                updated_at
        `,
        [
            parsedPath.path,
            year,
            title,
            imageCount,
            sortOrder,
            previewKey,
            cardId,
        ],
    );
    return mapCardRow(rows[0]);
}

export async function deleteCard(id) {
    const cardId = normalizeCardId(id);
    const { rows } = await pool.query(
        `
            DELETE FROM cards
            WHERE id = $1
            RETURNING
                id,
                path,
                year,
                title,
                image_count,
                sort_order,
                preview_key,
                created_at,
                updated_at
        `,
        [cardId],
    );
    return mapCardRow(rows[0]);
}

export async function updateCardImageCount(id, imageCount) {
    const cardId = normalizeCardId(id);
    const normalizedImageCount = normalizeImageCount(imageCount);
    const { rows } = await pool.query(
        `
            UPDATE cards
            SET image_count = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING
                id,
                path,
                year,
                title,
                image_count,
                sort_order,
                preview_key,
                created_at,
                updated_at
        `,
        [normalizedImageCount, cardId],
    );
    return mapCardRow(rows[0]);
}

export async function updateCardPreviewKey(id, previewKey) {
    const cardId = normalizeCardId(id);
    const normalizedPreviewKey = normalizePreviewKey(previewKey);
    const { rows } = await pool.query(
        `
            UPDATE cards
            SET preview_key = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING
                id,
                path,
                year,
                title,
                image_count,
                sort_order,
                preview_key,
                created_at,
                updated_at
        `,
        [normalizedPreviewKey, cardId],
    );
    return mapCardRow(rows[0]);
}
