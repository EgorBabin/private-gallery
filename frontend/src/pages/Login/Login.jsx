import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';
import styles from './Login.module.css';

export default function Login() {
  useTitle('Авторизация');

  const { authenticated, loading } = useCheckSession();

  const [remember, setRemember] = useState(false);
  const yandexHref = `/api/yandex${remember ? '?remember=1' : ''}`;
  const googleHref = `/api/google${remember ? '?remember=1' : ''}`;

  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && authenticated) {
      navigate(-1);
    }
    console.log('session loading:', loading, 'authenticated:', authenticated);
  }, [loading, authenticated, navigate]);

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

      <Link to="/passkey">Passkey</Link>
      <a className={styles.google} href={googleHref}>
        Google
      </a>
      <a className={styles.yandex} href={yandexHref}>
        Yandex
      </a>
    </div>
  );
}
