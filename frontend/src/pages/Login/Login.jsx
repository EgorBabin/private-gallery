import { Link } from 'react-router-dom'
import { useTitle } from '@/hooks/useTitle'
import styles from './Login.module.css'

export default function Login() {
    useTitle('Авторизация')
    return (
        <div className={styles.div}>
            <Link to="/google" className={styles.google}>Google</Link>
            <Link to="/yandex" className={styles.yandex}>Yandex</Link>
        </div>
    )
}
