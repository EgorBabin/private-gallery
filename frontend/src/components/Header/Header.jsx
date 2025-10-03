import { Link } from 'react-router-dom';
import styles from './Header.module.css';
import {
  Film,
  LogIn,
  Users,
  GlassWater,
  Sunset,
  MountainSnow,
  Trees,
} from 'lucide-react';
import { useVibration } from '@/hooks/useVibration';

export default function Header() {
  const vibrate = useVibration();
  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" onClick={() => vibrate('click')}>
          <Film strokeWidth={2} />
        </Link>
        {/* <a href="/api/hello" onClick={() => vibrate('click')}>
          <LayoutDashboard />
        </a> */}
        <Link to="/login" onClick={() => vibrate('click')}>
          <LogIn />
        </Link>
        <Link to="/users" onClick={() => vibrate('click')}>
          <Users />
        </Link>

        <Link to="/2028/ocean" onClick={() => vibrate('click')}>
          <GlassWater />
        </Link>
        <Link to="/2028/sunset" onClick={() => vibrate('click')}>
          <Sunset />
        </Link>
        <Link to="/2023/moun" onClick={() => vibrate('click')}>
          <MountainSnow />
        </Link>
        <Link to="/2013/forest" onClick={() => vibrate('click')}>
          <Trees />
        </Link>
      </nav>
    </header>
  );
}
