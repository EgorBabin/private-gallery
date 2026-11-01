import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Send } from 'lucide-react';

import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';
import { notify } from '@/utils/notifications';
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

// ошибки входа показываются тостами Sileo, как и остальные уведомления
const LOGIN_ERRORS = {
  not_found: {
    status: 'warning',
    title: 'Нет доступа',
    message:
      'Этот аккаунт не добавлен в галерею. Попросите администратора добавить вас.',
  },
  failed: {
    status: 'error',
    title: 'Не удалось войти',
    message: 'Попробуйте ещё раз.',
  },
};

function notifyLoginError(code) {
  notify(LOGIN_ERRORS[code] || LOGIN_ERRORS.failed);
}

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

// Логотип Google по правилам оформления кнопки входа; локальный SVG,
// без загрузки чего-либо с серверов Google
function GoogleIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
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
  const [searchParams, setSearchParams] = useSearchParams();
  const errorShownRef = useRef(false);
  const navigate = useNavigate();

  // ?error=... от бэкенда: показываем тост один раз и убираем параметр из
  // адреса, чтобы он не появлялся снова при обновлении страницы
  useEffect(() => {
    const code = searchParams.get('error');
    if (!code || errorShownRef.current) return;
    errorShownRef.current = true;
    notifyLoginError(code);
    const next = new URLSearchParams(searchParams);
    next.delete('error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
      notifyLoginError('failed');
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
      notifyLoginError('failed');
    }
  };

  const busy = pending !== null;
  const rememberQuery = remember ? '?remember=1' : '';
  const googleHref = `/api/google${rememberQuery}`;
  const yandexHref = `/api/yandex${rememberQuery}`;
  // переход по ссылке на OAuth: блокируем повторные нажатия
  const startRedirect = (provider) => (e) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    setPending(provider);
  };

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          Вход в галерею
        </h1>
        <p className={styles.subtitle}>
          Доступ только для добавленных пользователей
        </p>

        <div className={styles.buttons}>
          <a
            className={`${styles.button} ${styles.google}`}
            href={googleHref}
            onClick={startRedirect('google')}
            aria-disabled={busy}
            aria-busy={pending === 'google'}
          >
            <GoogleIcon />
            {pending === 'google'
              ? 'Переходим в Google…'
              : 'Войти через Google'}
          </a>

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
            onClick={startRedirect('yandex')}
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
