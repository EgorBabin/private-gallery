import { NavLink } from 'react-router-dom';
import { confirmLeave } from '@/hooks/useUnsavedGuard';
import styles from './Admin.module.css';

const TABS = [
  { to: '/admin', label: 'Пользователи', end: true },
  { to: '/admin/stats', label: 'Статистика' },
  { to: '/admin/logs', label: 'Журнал' },
];

export default function AdminNav() {
  return (
    <nav className={styles.tabs} aria-label="Разделы админки">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault();
          }}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
