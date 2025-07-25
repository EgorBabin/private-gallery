import { Link } from 'react-router-dom'
import styles from './Header.module.css'
import { Film, LayoutDashboard, LogIn, Users } from 'lucide-react';


export default function Header() {
    return (
        <header className={styles.header}>
            <nav className={styles.nav}>
                <Link to="/">
                    <Film  strokeWidth={2} />
                </Link>
                <Link to="/">
                    <LayoutDashboard />
                </Link>
                <Link to="/login">
                    <LogIn />
                </Link>
                <Link to="/users">
                    <Users />
                </Link>
            </nav>
        </header>
    )
}
