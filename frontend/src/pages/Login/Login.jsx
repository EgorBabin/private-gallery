import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Send } from 'lucide-react';

import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';
import styles from './Login.module.css';

// Вход через Telegram без виджета (без стороннего скрипта и iframe):
// переходим на oauth.telegram.org, он возвращает на /login с
// #tgAuthResult=<base64 JSON>, а проверку подписи делает бэкенд как раньше.
const TELEGRAM_OAUTH_URL = 'https://oauth.telegram.org/auth';
const TG_STATE_KEY = 'tg_auth_state';
const TG_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'username',
  'photo_url',
  'auth_date',
  'hash',
];

const ERROR_MESSAGES = {
  not_found:
    'Этот аккаунт не добавлен в галерею. Попросите администратора добавить вас.',
  failed: 'Не удалось войти. Попробуйте ещё раз.',
};

function decodeBase64Json(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** undefined — Telegram не возвращал результат, null — отказ или ошибка */
function readTelegramResult() {
  const match = window.location.hash.match(/tgAuthResult=([^&]+)/);
  if (!match) return undefined;
  try {
    const data = decodeBase64Json(decodeURIComponent(match[1]));
    return data && typeof data === 'object' && data.hash ? data : null;
  } catch {
    return null;
  }
}

function sessionStorageGet(key) {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

function TelegramIcon() {
  return <Send className={styles.icon} aria-hidden="true" />;
}

function YandexIcon() {
  return (
    <span className={styles.yandexMark} aria-hidden="true">
      Я
    </span>
  );
}

export default function Login() {
  useTitle('Авторизация');

  const { authenticated, loading } = useCheckSession();
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(null);
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(() => searchParams.get('error'));
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && authenticated) {
      navigate('/', { replace: true });
    }
  }, [loading, authenticated, navigate]);

  // «назад» из Яндекса/Telegram возвращает страницу из bfcache с нажатой кнопкой
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) setPending(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // возврат с oauth.telegram.org
  useEffect(() => {
    const result = readTelegramResult();
    if (result === undefined) return;

    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );

    const state = sessionStorageGet(TG_STATE_KEY);
    if (!result || !state) {
      setError('failed');
      return;
    }

    const query = new URLSearchParams();
    for (const field of TG_FIELDS) {
      const value = result[field];
      if (value !== undefined && value !== null && value !== '') {
        query.set(field, String(value));
      }
    }
    query.set('state', state);
    setPending('telegram');
    window.location.replace(`/api/telegram?${query}`);
  }, []);

  const startTelegram = async () => {
    setError(null);
    setPending('telegram');
    try {
      const res = await fetch(
        `/api/telegram/state?remember=${remember ? '1' : '0'}`,
        { credentials: 'include', headers: { Accept: 'application/json' } },
      );
      const data = res.ok ? await res.json() : null;
      if (data && data.state === null) {
        navigate('/', { replace: true });
        return;
      }
      if (!data?.state || !data?.botId) throw new Error('no state');

      sessionStorage.setItem(TG_STATE_KEY, data.state);
      const url = new URL(TELEGRAM_OAUTH_URL);
      url.searchParams.set('bot_id', data.botId);
      url.searchParams.set('origin', window.location.origin);
      url.searchParams.set('return_to', `${window.location.origin}/login`);
      window.location.assign(url.toString());
    } catch {
      setPending(null);
      setError('failed');
    }
  };

  const yandexHref = `/api/yandex${remember ? '?remember=1' : ''}`;
  const busy = pending !== null;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          Вход в галерею
        </h1>
        <p className={styles.subtitle}>
          Доступ только для добавленных пользователей
        </p>

        {error && (
          <p className={styles.error} role="alert">
            {ERROR_MESSAGES[error] || ERROR_MESSAGES.failed}
          </p>
        )}

        <div className={styles.buttons}>
          <button
            type="button"
            className={`${styles.button} ${styles.telegram}`}
            onClick={startTelegram}
            disabled={busy}
            aria-busy={pending === 'telegram'}
          >
            <TelegramIcon />
            {pending === 'telegram'
              ? 'Переходим в Telegram…'
              : 'Войти через Telegram'}
          </button>

          <a
            className={`${styles.button} ${styles.yandex}`}
            href={yandexHref}
            onClick={(e) => {
              if (busy) {
                e.preventDefault();
                return;
              }
              setPending('yandex');
            }}
            aria-disabled={busy}
            aria-busy={pending === 'yandex'}
          >
            <YandexIcon />
            {pending === 'yandex'
              ? 'Переходим в Яндекс…'
              : 'Войти через Яндекс'}
          </a>
        </div>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
          />
          Запомнить меня на 30 дней
        </label>
      </section>
    </main>
  );
}
