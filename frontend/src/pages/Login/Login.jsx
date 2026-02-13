import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';
import styles from './Login.module.css';

export default function Login() {
  useTitle('Авторизация');

  const { authenticated, loading } = useCheckSession();
  const [remember, setRemember] = useState(false);
  const navigate = useNavigate();
  const telegramRootRef = useRef(null);

  useEffect(() => {
    if (!loading && authenticated) {
      navigate(-1);
    }
  }, [loading, authenticated, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined' || !telegramRootRef.current) return;

    const container = telegramRootRef.current;
    container.innerHTML = '';
    let cancelled = false;

    const initWidget = async () => {
      const rememberValue = remember ? '1' : '0';
      let authUrl = `${window.location.origin}/api/telegram?remember=${rememberValue}`;

      try {
        const stateResponse = await fetch(
          `/api/telegram/state?remember=${rememberValue}`,
          {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          },
        );
        if (stateResponse.ok) {
          const data = await stateResponse.json();
          if (data?.state) {
            authUrl += `&state=${encodeURIComponent(data.state)}`;
          }
        }
      } catch (err) {
        console.debug('Failed to initialize telegram auth state:', err);
      }

      if (cancelled) {
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.async = true;
      script.setAttribute(
        'data-telegram-login',
        import.meta.env.VITE_TG_BOT_USERNAME,
      );
      script.setAttribute('data-size', 'large');
      script.setAttribute('data-auth-url', authUrl);

      container.appendChild(script);
    };

    void initWidget();

    return () => {
      cancelled = true;
      container.innerHTML = '';
    };
  }, [remember]);

  const yandexHref = `/api/yandex${remember ? '?remember=1' : ''}`;

  return (
    <div className={styles.div}>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Запомнить меня
      </label>

      <div ref={telegramRootRef} className={styles.telegram}>
        {/* Фоллбек ссылка для случаев, когда скрипт заблокирован */}
        <a href={`/api/telegram${remember ? '?remember=1' : ''}`}>Telegram</a>
      </div>

      <a className={styles.yandex} href={yandexHref}>
        Yandex
      </a>
    </div>
  );
}
