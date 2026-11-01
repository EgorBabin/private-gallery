import { useCallback, useEffect, useState } from 'react';
import styles from './Admin.module.css';
import AdminNav from './AdminNav';
import { useTitle } from '@/hooks/useTitle';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { parseApiResponse } from '@/utils/apiResponse';
import { notify, notifyError } from '@/utils/notifications';
import { formatDateTime, formatRelative } from '@/utils/formatTime';

const METHOD_LABELS = {
  google: 'Google',
  telegram: 'Telegram',
  yandex: 'Яндекс',
};

function Tile({ value, label }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileValue}>{value}</div>
      <div className={styles.tileLabel}>{label}</div>
    </div>
  );
}

export default function StatsPage() {
  useTitle('Статистика');
  const csrfFetch = useCsrfFetch();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats', { credentials: 'include' });
      const { data } = await parseApiResponse(
        res,
        'Не удалось загрузить статистику',
      );
      setStats(data);
    } catch (e) {
      notifyError(e, 'Не удалось загрузить статистику');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revokeSessions = async (user) => {
    if (
      !window.confirm(
        `Завершить все сессии ${user.username}? Пользователю придётся войти заново на всех устройствах.`,
      )
    ) {
      return;
    }
    setRevoking(user.id);
    try {
      const res = await csrfFetch(
        `/api/admin/users/${user.id}/revoke-sessions`,
        { method: 'POST' },
      );
      const { message, status } = await parseApiResponse(
        res,
        'Не удалось завершить сессии',
      );
      notify({ status, title: 'Сессии завершены', message });
      await load();
    } catch (e) {
      notifyError(e, 'Не удалось завершить сессии');
    } finally {
      setRevoking(null);
    }
  };

  const totals = stats?.totals;
  const users = stats?.users || [];
  const active = users.filter((u) => u.isActive);
  const inactive = users.filter((u) => !u.isActive);

  const renderUser = (user) => (
    <div
      key={user.id}
      className={`${styles.card} ${user.isActive ? '' : styles.cardInactive}`}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardName}>{user.username}</span>
        <div className={styles.badges}>
          {user.online && (
            <span className={`${styles.badge} ${styles.badgeOk}`}>
              ● онлайн
            </span>
          )}
          {user.role === 'admin' && (
            <span className={`${styles.badge} ${styles.badgeAccent}`}>
              admin
            </span>
          )}
          {!user.isActive && (
            <span className={`${styles.badge} ${styles.badgeFail}`}>
              отключён
            </span>
          )}
        </div>
      </div>

      <div className={styles.kv}>
        <span className={styles.kvKey}>Последний вход</span>
        <span
          className={styles.kvValue}
          title={formatDateTime(user.lastLoginAt)}
        >
          {formatRelative(user.lastLoginAt)}
          {user.lastLoginMethod
            ? ` · ${METHOD_LABELS[user.lastLoginMethod] || user.lastLoginMethod}`
            : ''}
        </span>
        {user.lastLoginIp && (
          <>
            <span className={styles.kvKey}>Откуда</span>
            <span className={styles.kvValue}>
              {user.lastLoginIp}
              {user.lastLoginDevice ? ` · ${user.lastLoginDevice}` : ''}
            </span>
          </>
        )}
        <span className={styles.kvKey}>Был в галерее</span>
        <span
          className={styles.kvValue}
          title={formatDateTime(user.lastSeenAt)}
        >
          {formatRelative(user.lastSeenAt)}
        </span>
        <span className={styles.kvKey}>Входов</span>
        <span className={styles.kvValue}>{user.logins}</span>
        <span className={styles.kvKey}>Загрузил фото</span>
        <span className={styles.kvValue}>{user.uploaded}</span>
        <span className={styles.kvKey}>Открывал папки</span>
        <span className={styles.kvValue}>
          {user.folderViews} раз, разных: {user.foldersSeen}
        </span>
        <span className={styles.kvKey}>Активных сессий</span>
        <span className={styles.kvValue}>{user.activeSessions}</span>
        <span className={styles.kvKey}>Email</span>
        <span className={styles.kvValue}>{user.email.join(', ') || '—'}</span>
        <span className={styles.kvKey}>Добавлен</span>
        <span className={styles.kvValue}>{formatDateTime(user.createdAt)}</span>
      </div>

      {user.activeSessions > 0 && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonDanger}`}
            disabled={revoking === user.id}
            onClick={() => revokeSessions(user)}
          >
            {revoking === user.id ? 'Завершаем…' : 'Выйти на всех устройствах'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      <AdminNav />
      <div className={styles.cardHead}>
        <h1 className={styles.title}>Статистика</h1>
        <button
          type="button"
          className={styles.button}
          onClick={load}
          disabled={loading}
        >
          {loading ? 'Обновляем…' : 'Обновить'}
        </button>
      </div>

      {totals && (
        <div className={styles.tiles}>
          <Tile value={totals.activeUsers} label="Могут входить" />
          <Tile value={totals.onlineUsers} label="Сейчас онлайн" />
          <Tile value={totals.media} label="Фото и видео" />
          <Tile value={totals.folders} label="Папок" />
          <Tile value={totals.logins7d} label="Входов за 7 дней" />
          <Tile
            value={totals.failedLogins7d}
            label="Неудачных входов за 7 дней"
          />
          <Tile value={totals.uploads30d} label="Загружено за 30 дней" />
        </div>
      )}

      {!stats && loading && <p className={styles.empty}>Загрузка…</p>}

      {active.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>Имеют доступ</h2>
          <div className={styles.cards}>{active.map(renderUser)}</div>
        </section>
      )}

      {inactive.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Отключены</h2>
          <div className={styles.cards}>{inactive.map(renderUser)}</div>
        </section>
      )}
    </div>
  );
}
