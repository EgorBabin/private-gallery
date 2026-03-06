export class ApiError extends Error {
  constructor(
    message,
    { status = 'error', httpStatus = 0, payload = null } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.httpStatus = httpStatus;
    this.payload = payload;
  }
}

const SUCCESS_STATUSES = new Set(['success', 'ok', 'done']);
const INFO_STATUSES = new Set([
  'accepted',
  'queued',
  'processing',
  'running',
  'info',
]);
const WARNING_STATUSES = new Set(['warning']);
const ERROR_STATUSES = new Set(['error', 'fail', 'failed']);

export function normalizeToastStatus(
  rawStatus,
  { ok = true, httpStatus = 0 } = {},
) {
  const status = String(rawStatus || '')
    .trim()
    .toLowerCase();

  if (SUCCESS_STATUSES.has(status)) {
    return 'success';
  }
  if (INFO_STATUSES.has(status)) {
    return 'info';
  }
  if (WARNING_STATUSES.has(status)) {
    return 'warning';
  }
  if (ERROR_STATUSES.has(status)) {
    return 'error';
  }

  if (ok) {
    return 'success';
  }
  if (httpStatus >= 500) {
    return 'error';
  }
  return 'warning';
}

function pickMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const message =
    (typeof payload.message === 'string' && payload.message.trim()) ||
    (typeof payload.error === 'string' && payload.error.trim()) ||
    '';

  return message || fallback;
}

export async function parseApiResponse(res, fallbackMessage) {
  const contentType = res.headers.get('content-type') || '';
  let data = null;

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  const defaultMessage =
    fallbackMessage || (res.ok ? 'Операция выполнена' : `Ошибка ${res.status}`);
  const message = pickMessage(data, defaultMessage);
  const status = normalizeToastStatus(data?.status, {
    ok: res.ok,
    httpStatus: res.status,
  });

  if (!res.ok) {
    throw new ApiError(message, {
      status,
      httpStatus: res.status,
      payload: data,
    });
  }

  return { data, message, status };
}
