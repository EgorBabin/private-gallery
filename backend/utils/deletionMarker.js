const RETENTION_DAYS_DEFAULT = 30;
const SOFT_DELETE_PREFIX = 'delete_';
const SOFT_DELETE_CREATED_TAG = '__deleteCreated_';
const SOFT_DELETE_BASE_RE = /^delete_(.+)__deleteCreated_(\d{8})$/;
const SOFT_DELETE_BASE_RE_LEGACY = /^delete_(.+)__deleteAt_(\d{8})$/;
const SOFT_DELETE_BASE_RE_LEGACY_GENERIC = /^delete_(.+?)(?:__|_|-)(\d{8})$/;

const rawRetentionDays = Number(
    process.env.GALLERY_SOFT_DELETE_RETENTION_DAYS || RETENTION_DAYS_DEFAULT,
);
const SOFT_DELETE_RETENTION_DAYS =
    Number.isInteger(rawRetentionDays) && rawRetentionDays > 0
        ? rawRetentionDays
        : RETENTION_DAYS_DEFAULT;

function toUtcDateStart(inputDate) {
    const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
}

function toUtcDateEnd(inputDate) {
    const date = toUtcDateStart(inputDate);
    date.setUTCHours(23, 59, 59, 999);
    return date;
}

function formatDateToken(inputDate) {
    const date = toUtcDateStart(inputDate);
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function subtractDays(inputDate, days) {
    const normalizedDays = Number.isInteger(days) && days > 0 ? days : 0;
    const date = toUtcDateStart(inputDate);
    date.setUTCDate(date.getUTCDate() - normalizedDays);
    return toUtcDateEnd(date);
}

function parseDateToken(token) {
    const cleanToken = String(token || '').trim();
    if (!/^\d{8}$/.test(cleanToken)) {
        return null;
    }

    const year = Number(cleanToken.slice(0, 4));
    const month = Number(cleanToken.slice(4, 6));
    const day = Number(cleanToken.slice(6, 8));
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day)
    ) {
        return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return toUtcDateEnd(date);
}

export function getSoftDeleteRetentionDays() {
    return SOFT_DELETE_RETENTION_DAYS;
}

export function computeSoftDeleteDueDate(
    fromDate = new Date(),
    retentionDays = SOFT_DELETE_RETENTION_DAYS,
) {
    const normalizedRetention =
        Number.isInteger(retentionDays) && retentionDays > 0
            ? retentionDays
            : SOFT_DELETE_RETENTION_DAYS;
    const date = toUtcDateStart(fromDate);
    date.setUTCDate(date.getUTCDate() + normalizedRetention);
    return toUtcDateEnd(date);
}

export function computeSoftDeleteCreatedDate(fromDate = new Date()) {
    return toUtcDateEnd(fromDate);
}

export function computeSoftDeleteCreatedDateFromDueDate(
    dueDate = new Date(),
    retentionDays = SOFT_DELETE_RETENTION_DAYS,
) {
    return subtractDays(dueDate, retentionDays);
}

export function parseSoftDeleteBase(baseName) {
    const cleanBase = String(baseName || '').trim();
    const match = cleanBase.match(SOFT_DELETE_BASE_RE);
    if (match) {
        const originalBase = String(match[1] || '').trim();
        const deleteCreatedAtToken = String(match[2] || '').trim();
        const deleteCreatedAt = parseDateToken(deleteCreatedAtToken);
        if (!originalBase || !deleteCreatedAt) {
            return null;
        }

        const deleteAt = computeSoftDeleteDueDate(deleteCreatedAt);
        return {
            originalBase,
            deleteCreatedAtToken,
            deleteCreatedAt,
            deleteAtToken: formatDateToken(deleteAt),
            deleteAt,
            markerType: 'created-date',
        };
    }

    const legacyMatch = cleanBase.match(SOFT_DELETE_BASE_RE_LEGACY);
    if (legacyMatch) {
        const originalBase = String(legacyMatch[1] || '').trim();
        const deleteAtToken = String(legacyMatch[2] || '').trim();
        const deleteAt = parseDateToken(deleteAtToken);
        if (!originalBase || !deleteAt) {
            return null;
        }

        const deleteCreatedAt =
            computeSoftDeleteCreatedDateFromDueDate(deleteAt);
        return {
            originalBase,
            deleteCreatedAtToken: formatDateToken(deleteCreatedAt),
            deleteCreatedAt,
            deleteAtToken,
            deleteAt,
            markerType: 'legacy-due-date',
        };
    }

    const genericLegacyMatch = cleanBase.match(
        SOFT_DELETE_BASE_RE_LEGACY_GENERIC,
    );
    if (!genericLegacyMatch) {
        return null;
    }

    const originalBase = String(genericLegacyMatch[1] || '').trim();
    const deleteAtToken = String(genericLegacyMatch[2] || '').trim();
    const deleteAt = parseDateToken(deleteAtToken);
    if (!originalBase || !deleteAt) {
        return null;
    }

    const deleteCreatedAt = computeSoftDeleteCreatedDateFromDueDate(deleteAt);
    return {
        originalBase,
        deleteCreatedAtToken: formatDateToken(deleteCreatedAt),
        deleteCreatedAt,
        deleteAtToken,
        deleteAt,
        markerType: 'legacy-due-date',
    };
}

export function isSoftDeletedBase(baseName) {
    return Boolean(parseSoftDeleteBase(baseName));
}

export function restoreSoftDeleteBase(baseName) {
    const parsed = parseSoftDeleteBase(baseName);
    return parsed ? parsed.originalBase : String(baseName || '').trim();
}

export function buildSoftDeletedBase(originalBaseName, opts = {}) {
    const cleanBase = String(originalBaseName || '').trim();
    if (!cleanBase) {
        throw new Error('originalBaseName is required for soft delete');
    }
    if (isSoftDeletedBase(cleanBase)) {
        return cleanBase;
    }

    const deleteCreatedAt = opts.createdAt
        ? toUtcDateEnd(opts.createdAt)
        : computeSoftDeleteCreatedDate(new Date(), opts.retentionDays);
    return `${SOFT_DELETE_PREFIX}${cleanBase}${SOFT_DELETE_CREATED_TAG}${formatDateToken(deleteCreatedAt)}`;
}

export function parseNumericIndexFromBase(baseName) {
    const rawBase = restoreSoftDeleteBase(baseName);
    const bare = rawBase.replace(/^video_/, '');
    const match = bare.match(/(\d+)$/);
    if (!match) {
        return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}
