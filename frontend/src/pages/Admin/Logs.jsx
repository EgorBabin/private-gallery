import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Admin.module.css';
import AdminNav from './AdminNav';
import { useTitle } from '@/hooks/useTitle';
import { parseApiResponse } from '@/utils/apiResponse';
import { notifyError } from '@/utils/notifications';
import { formatDateTime, formatRelative } from '@/utils/formatTime';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 400;

const CATEGORIES = [
  ['', 'Все события'],
  ['auth', 'Входы'],
  ['security', 'Безопасность'],
  ['admin', 'Админка'],
  ['activity', 'Просмотры'],
  ['error', 'Ошибки'],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.filter(([v]) => v));

function badgeClass(item) {
  if (item.outcome === 'fail') return `${styles.badge} ${styles.badgeFail}`;
  if (item.outcome === 'ok') return `${styles.badge} ${styles.badgeOk}`;
  if (item.category === 'security')
    return `${styles.badge} ${styles.badgeWarn}`;
  return styles.badge;
}

export default function LogsPage() {
  useTitle('Журнал');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [order, setOrder] = useState('desc');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  // поиск с задержкой, чтобы не дёргать сервер на каждую букву
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (fromCursor) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), order });
        if (search) params.set('q', search);
        if (category) params.set('category', category);
        if (onlyFailures) params.set('outcome', 'fail');
        if (fromCursor) {
          params.set(order === 'asc' ? 'after' : 'before', String(fromCursor));
        }
        const res = await fetch(`/api/admin/logs?${params}`, {
          credentials: 'include',
        });
        const { data } = await parseApiResponse(
          res,
          'Не удалось загрузить журнал',
        );
        if (requestId !== requestRef.current) return; // пришёл устаревший ответ
        const page = Array.isArray(data?.items) ? data.items : [];
        setItems((prev) => (fromCursor ? [...prev, ...page] : page));
        setCursor(data?.nextCursor ?? null);
      } catch (e) {
        notifyError(e, 'Не удалось загрузить журнал');
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [search, category, onlyFailures, order],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <div className={styles.page}>
      <AdminNav />
      <div className={styles.cardHead}>
        <h1 className={styles.title}>Журнал</h1>
        <button
          type="button"
          className={styles.button}
          onClick={() => load(null)}
          disabled={loading}
        >
          Обновить
        </button>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.input}
          type="search"
          placeholder="Поиск: действие, email, IP, устройство, путь"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={styles.select}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        >
          <option value="desc">Сначала новые</option>
          <option value="asc">Сначала старые</option>
        </select>
      </div>
      <label className={styles.field} style={{ flexDirection: 'row', gap: 8 }}>
        <input
          type="checkbox"
          checked={onlyFailures}
          onChange={(e) => setOnlyFailures(e.target.checked)}
        />
        Только неудачные (отказы входа, ошибки)
      </label>

      <div className={styles.logList} style={{ marginTop: 10 }}>
        {items.map((item) => (
          <div key={item.id} className={styles.logItem}>
            <div className={styles.logTop}>
              <span
                className={styles.logTime}
                title={formatRelative(item.createdAt)}
              >
                {formatDateTime(item.createdAt)}
              </span>
              <span className={badgeClass(item)}>
                {CATEGORY_LABELS[item.category] || item.category}
              </span>
              <span className={styles.logAction}>{item.action}</span>
            </div>
            {item.details && (
              <div className={styles.logMeta}>{item.details}</div>
            )}
            <div className={styles.logMeta}>
              {[
                item.email || 'без входа',
                item.ip,
                item.device,
                item.method && item.path ? `${item.method} ${item.path}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        ))}
      </div>

      {!loading && items.length === 0 && (
        <p className={styles.empty}>Записей нет</p>
      )}
      {loading && <p className={styles.empty}>Загрузка…</p>}
      {!loading && cursor && (
        <button
          type="button"
          className={`${styles.button} ${styles.loadMore}`}
          onClick={() => load(cursor)}
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
