import { useEffect, useRef } from 'react';
import styles from './ScrollProgressBar.module.css';

export default function ScrollProgressBar() {
  const barRef = useRef(null);
  const ticking = useRef(false);
  const maxScroll = useRef(1);

  useEffect(() => {
    const render = () => {
      const progress = Math.min(1, window.scrollY / maxScroll.current);
      if (barRef.current) {
        // transform не вызывает перерасчёт layout, в отличие от width
        barRef.current.style.transform = `scaleX(${progress})`;
      }
      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        ticking.current = true;
        window.requestAnimationFrame(render);
      }
    };

    // высоту страницы меряем только когда она меняется, а не на каждый кадр скролла
    const measure = () => {
      maxScroll.current = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      onScroll();
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(document.body);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  return <div ref={barRef} className={styles.progressBar} />;
}
