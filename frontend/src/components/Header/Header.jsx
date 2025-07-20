import { Link } from 'react-router-dom'
import styles from './Header.module.css'

export default function Header() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const icon = prefersDark ? '/favicon.light.svg' : '/favicon.dark.svg';
    return (
        <header className={styles.header}>
            <nav className={styles.nav}>
                <Link to="/"><img src={icon} alt='favicon' /></Link>
                <Link to="/login">Войти</Link>
                <Link to="/users">Пользователи</Link>
            </nav>
        </header>
    )
}
