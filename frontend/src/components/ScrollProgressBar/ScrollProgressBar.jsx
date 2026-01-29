import { useEffect, useRef } from 'react';
import styles from './ScrollProgressBar.module.css';

export default function ScrollProgressBar() {
  const barRef = useRef(null);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const height = document.body.scrollHeight - window.innerHeight;
          const scrollTop = document.documentElement.scrollTop;
          const progress = (scrollTop / height) * 100;

          if (barRef.current) {
            barRef.current.style.width = `${progress}%`;
          }

          ticking.current = false;
        });

        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return <div ref={barRef} className={styles.progressBar} />;
}
