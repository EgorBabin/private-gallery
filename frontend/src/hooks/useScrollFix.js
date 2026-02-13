import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function useScrollFix({
  maxRetries = 60,
  retryInterval = 100,
  behavior = 'auto',
  topOnNavigation = true,
} = {}) {
  const location = useLocation();
  const cleanupRef = useRef(null);

  const findByHash = useCallback((hash) => {
    if (!hash) return null;
    const id = decodeURIComponent(hash.slice(1));
    let el = null;
    try {
      if (window.CSS && CSS.escape) {
        el = document.querySelector(`#${CSS.escape(id)}`);
      } else {
        el = document.getElementById(id);
      }
    } catch {
      el = document.getElementById(id);
    }
    if (!el) {
      el = document.querySelector(`[name="${id}"]`);
    }
    return el;
  }, []);

  const scrollToTarget = useCallback(
    (target) => {
      if (typeof target === 'number') {
        window.scrollTo({ top: target, behavior });
      } else if (target instanceof Element) {
        target.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
      } else {
        window.scrollTo({ top: 0, behavior });
      }
    },
    [behavior],
  );

  const scrollToHashWithRetries = useCallback(
    (hash) => {
      if (!hash) return null;
      let attempts = 0;
      let intervalId = null;
      let observer = null;
      let finished = false;

      const cleanup = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        finished = true;
      };

      const tryOnce = () => {
        if (finished) return true;
        attempts += 1;
        const el = findByHash(hash);
        if (el) {
          cleanup();
          scrollToTarget(el);
          return true;
        }
        if (attempts >= maxRetries) {
          cleanup();
          return false;
        }
        return false;
      };

      if (tryOnce()) return cleanup;

      intervalId = setInterval(() => {
        tryOnce();
      }, retryInterval);

      observer = new MutationObserver(() => {
        tryOnce();
      });
      observer.observe(document.body, { childList: true, subtree: true });

      return cleanup;
    },
    [findByHash, maxRetries, retryInterval, scrollToTarget],
  );

  useEffect(() => {
    if (cleanupRef.current) {
      try {
        cleanupRef.current();
      } catch {
        // Ignore cleanup failures when navigating away.
      }
      cleanupRef.current = null;
    }

    if (location.hash) {
      cleanupRef.current = scrollToHashWithRetries(location.hash);
    } else if (topOnNavigation) {
      setTimeout(() => {
        scrollToTarget(0);
      }, 0);
    }

    return () => {
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch {
          // Ignore cleanup failures during unmount.
        }
        cleanupRef.current = null;
      }
    };
  }, [
    location.pathname,
    location.search,
    location.hash,
    topOnNavigation,
    scrollToHashWithRetries,
    scrollToTarget,
  ]);
}
