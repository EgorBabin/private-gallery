import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import styles from './Header.module.css';
import { Film, ArrowUpToLine, Users, FolderCog } from 'lucide-react';
import { useVibration } from '@/hooks/useVibration';

export default function Header() {
  const vibrate = useVibration();
  const location = useLocation();
  const navigate = useNavigate();

  const isEditPath = location.pathname.startsWith('/edit/');
  const editPath = isEditPath
    ? location.pathname.replace('/edit/', '/')
    : `/edit${location.pathname}`;

  const [scrolled, setScrolled] = useState(() => window.scrollY > 10);
  const rafRef = useRef(null);
  const isScrollingRef = useRef(false);
  const scrollControllerRef = useRef(null);
  const PATH_ROOT = '/';
  const isRoot = location.pathname === PATH_ROOT;

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    setScrolled(window.scrollY > 10);
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [location.pathname]);

  function startSmoothScrollToTop(duration = 400, onDone = () => {}) {
    const start = window.scrollY;
    if (start === 0) {
      onDone();
      return { cancel: () => {} };
    }
    let startTime = null;
    let canceled = false;
    isScrollingRef.current = true;

    const step = (time) => {
      if (canceled) return;
      if (!startTime) startTime = time;
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      window.scrollTo(0, Math.round(start * (1 - ease)));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        isScrollingRef.current = false;
        rafRef.current = null;
        onDone();
      }
    };

    rafRef.current = requestAnimationFrame(step);

    const controller = {
      cancel: () => {
        canceled = true;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        isScrollingRef.current = false;
        rafRef.current = null;
      },
    };
    scrollControllerRef.current = controller;
    return controller;
  }

  const handleMainClick = (e) => {
    e.preventDefault();
    vibrate('click');

    const currentlyScrolled = window.scrollY > 10;

    if (isRoot) {
      if (currentlyScrolled) {
        if (isScrollingRef.current) {
          scrollControllerRef.current?.cancel();
          return;
        }
        startSmoothScrollToTop(400, () => {});
      } else {
        window.location.reload();
      }
      return;
    }

    if (!isRoot) {
      if (!currentlyScrolled) {
        navigate(PATH_ROOT);
        return;
      }

      if (isScrollingRef.current) {
        scrollControllerRef.current?.cancel();
        navigate(PATH_ROOT);
        return;
      }

      startSmoothScrollToTop(400, () => {});
    }
  };

  return (
    <>
      <div className={styles.viewportGradient} aria-hidden="true" />
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link
            aria-label="Главная"
            onClick={handleMainClick}
            title={
              isRoot
                ? scrolled
                  ? 'Вверх'
                  : 'Перезагрузить'
                : scrolled
                  ? 'Вверх'
                  : 'Перейти на главную'
            }
          >
            {scrolled ? (
              <ArrowUpToLine strokeWidth={2} />
            ) : (
              <Film strokeWidth={2} />
            )}
          </Link>

          <Link to={editPath} onClick={() => vibrate('click')}>
            <FolderCog />
          </Link>

          <Link to="/admin" onClick={() => vibrate('click')}>
            <Users />
          </Link>
        </nav>
      </header>
    </>
  );
}
