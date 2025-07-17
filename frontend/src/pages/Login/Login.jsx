import { Link } from 'react-router-dom'
import { useTitle } from '@/hooks/useTitle'
import styles from './Login.module.css'

export default function Login() {
    useTitle('Авторизация')
    return (
        <div className={styles.div}>
            <Link to="/google" className={styles.google}>Google</Link>
            <a href="http://localhost:3000/api/auth/yandex" className={styles.yandex}>Yandex</a>

            <a href="http://localhost:3000/api/auth/yandex">
                <button>Войти через Яндекс</button>
            </a>
        </div>
    )
}
