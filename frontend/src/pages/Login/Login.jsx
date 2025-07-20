import { useState } from 'react'
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { checkSession } from '@/hooks/checkSession';
import { useTitle } from '@/hooks/useTitle'
import styles from './Login.module.css'

export default function Login() {
    useTitle('Авторизация')
    
    const [remember, setRemember] = useState(false)

    const yandexHref = `http://localhost:3000/yandex${remember ? '?remember=1' : ''}`
    const googleHref = `http://localhost:3000/google${remember ? '?remember=1' : ''}`

    const navigate = useNavigate();

    useEffect(() => {
        checkSession().then(data => {
            if (data.authenticated) {
                navigate('/');
            }
        });
    }, []);

    return (
        <div className={styles.div}>
            <label className={styles.checkbox}>
                <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                />
                Запомнить меня
            </label>

            <a className={styles.google} href={googleHref}>Google</a>
            <a className={styles.yandex} href={yandexHref}>Yandex</a>
        </div>
    )
}
