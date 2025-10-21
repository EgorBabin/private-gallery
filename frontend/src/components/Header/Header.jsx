import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.css';
import { Film, Users, GalleryVertical } from 'lucide-react';
import { useVibration } from '@/hooks/useVibration';

export default function Header() {
  const vibrate = useVibration();
  const location = useLocation();
  const newSearch = location.search ? `${location.search}&edit` : '?edit';
  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" onClick={() => vibrate('click')}>
          <Film strokeWidth={2} />
        </Link>
        <Link
          to={`${location.pathname}${newSearch}`}
          onClick={() => vibrate('click')}
        >
          <GalleryVertical />
        </Link>
        <Link to="/admin" onClick={() => vibrate('click')}>
          <Users />
        </Link>
      </nav>
    </header>
  );
}
