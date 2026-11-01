const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const relativeFormat = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
}

/** «5 минут назад», «вчера», «только что». */
export function formatRelative(value) {
  if (!value) return 'никогда';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(diffSec) < 60) return 'только что';
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diffSec) >= seconds) {
      return relativeFormat.format(Math.round(diffSec / seconds), unit);
    }
  }
  return 'только что';
}
