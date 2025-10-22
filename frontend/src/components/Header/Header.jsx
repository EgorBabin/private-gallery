import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.css';
import { Film, Users, GalleryVertical } from 'lucide-react';
import { useVibration } from '@/hooks/useVibration';

export default function Header() {
  const vibrate = useVibration();
  const location = useLocation();

  const isEditPath = location.pathname.startsWith('/edit/');
  const editPath = isEditPath
    ? location.pathname.replace('/edit/', '/')
    : `/edit${location.pathname}`;

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" onClick={() => vibrate('click')}>
          <Film strokeWidth={2} />
        </Link>
        <Link to={editPath} onClick={() => vibrate('click')}>
          <GalleryVertical />
        </Link>
        <Link to="/admin" onClick={() => vibrate('click')}>
          <Users />
        </Link>
      </nav>
    </header>
  );
}
