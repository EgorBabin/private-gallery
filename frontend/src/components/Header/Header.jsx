import { Link } from 'react-router-dom'
import styles from './Header.module.css'
import { Film, SplinePointer } from 'lucide-react';


export default function Header() {
    return (
        <header className={styles.header}>
            <nav className={styles.nav}>
                <Link to="/" state={{ forceScroll: true }} ><Film /></Link>
                <Link to="/" ><SplinePointer /></Link>

                <Link to="/login">Войти</Link>
                <Link to="/users">Пользователи</Link>
            </nav>
        </header>
    )
}
