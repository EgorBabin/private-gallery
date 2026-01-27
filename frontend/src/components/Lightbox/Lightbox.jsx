import React, { useEffect, useState, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard, Scrollbar } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/scrollbar';

import styles from './Lightbox.module.css';

export default function Lightbox({
  items,
  startIndex = 0,
  onClose,
  fetchOriginal,
}) {
  const [current, setCurrent] = useState(startIndex);
  const [origUrls, setOrigUrls] = useState([]);
  const swiperRef = useRef(null);
  const overlayRef = useRef(null);
  const isTouchingPinchRef = useRef(false);

  useEffect(() => setCurrent(startIndex), [startIndex]);

  useEffect(() => {
    (async () => {
      const toLoad = [current, current - 1, current + 1];
      await Promise.all(
        toLoad.map(async (i) => {
          if (i < 0 || i >= items.length) return;
          if (origUrls[i]) return;
          if (typeof fetchOriginal === 'function') {
            try {
              const url = await fetchOriginal(i);
              if (url) {
                setOrigUrls((prev) => {
                  const copy = prev.slice();
                  copy[i] = url;
                  return copy;
                });
              }
            } catch {}
          }
        }),
      );
    })();
  }, [current, items.length, fetchOriginal, origUrls]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const isTouchDevice =
      'ontouchstart' in window || window.matchMedia('(pointer:coarse)').matches;
    if (!isTouchDevice) return;

    let activeTouches = 0;

    const getSwiper = () => swiperRef.current?.swiper;

    const onTouchStart = (e) => {
      activeTouches = e.touches ? e.touches.length : 0;
      if (activeTouches === 2) {
        isTouchingPinchRef.current = true;
        const s = getSwiper();
        if (s) {
          s.allowTouchMove = false;
        }
        overlay.style.touchAction = 'auto';
        overlay.style.webkitTouchCallout = 'auto';
        overlay.style.webkitUserSelect = 'auto';
      }
    };

    const onTouchEnd = (e) => {
      const remaining = e.touches ? e.touches.length : 0;
      activeTouches = remaining;
      if (isTouchingPinchRef.current && remaining < 2) {
        isTouchingPinchRef.current = false;
        const s = getSwiper();
        if (s) {
          s.allowTouchMove = true;
        }
        overlay.style.touchAction = '';
        overlay.style.webkitTouchCallout = '';
        overlay.style.webkitUserSelect = '';
      }
    };

    const onTouchCancel = onTouchEnd;

    overlay.addEventListener('touchstart', onTouchStart, { passive: true });
    overlay.addEventListener('touchend', onTouchEnd, { passive: true });
    overlay.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      overlay.removeEventListener('touchstart', onTouchStart);
      overlay.removeEventListener('touchend', onTouchEnd);
      overlay.removeEventListener('touchcancel', onTouchCancel);
      const s = getSwiper();
      if (s) {
        s.allowTouchMove = true;
      }
      overlay.style.touchAction = '';
      overlay.style.webkitTouchCallout = '';
      overlay.style.webkitUserSelect = '';
    };
  }, [items]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previousBodyStyles = {
      position: document.body.style.position || '',
      top: document.body.style.top || '',
      left: document.body.style.left || '',
      right: document.body.style.right || '',
      width: document.body.style.width || '',
      overflow: document.body.style.overflow || '',
    };

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    const isEventInsideOverlay = (e) => {
      try {
        return overlay && overlay.contains(e.target);
      } catch {
        return false;
      }
    };

    const onWheel = (e) => {
      if (!isEventInsideOverlay(e)) {
        e.preventDefault();
      }
    };
    const onTouchMove = (e) => {
      if (!isEventInsideOverlay(e)) {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', onWheel, {
      passive: false,
      capture: true,
    });
    window.addEventListener('touchmove', onTouchMove, {
      passive: false,
      capture: true,
    });

    const onKeyDown = (e) => {
      const keys = [
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' ',
        'ArrowUp',
        'ArrowDown',
      ];
      if (keys.includes(e.key) && !isEventInsideOverlay(e)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });

    return () => {
      document.body.style.position = previousBodyStyles.position;
      document.body.style.top = previousBodyStyles.top;
      document.body.style.left = previousBodyStyles.left;
      document.body.style.right = previousBodyStyles.right;
      document.body.style.width = previousBodyStyles.width;
      document.body.style.overflow = previousBodyStyles.overflow;

      window.scrollTo(0, scrollY);

      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('touchmove', onTouchMove, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);

  useEffect(() => {
    const lightboxParam = 'lightbox';
    const searchParams = new URLSearchParams(window.location.search);

    if (!searchParams.has(lightboxParam)) {
      searchParams.set(lightboxParam, '1');
      window.history.pushState(
        { lightbox: true },
        '',
        '?' + searchParams.toString(),
      );
    }

    const handlePopState = (e) => {
      const params = new URLSearchParams(window.location.search);
      if (!params.has(lightboxParam)) {
        onClose();
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);

      const params = new URLSearchParams(window.location.search);
      if (params.has(lightboxParam)) {
        params.delete(lightboxParam);
        window.history.replaceState({}, '', '?' + params.toString());
      }
    };
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        <Swiper
          ref={swiperRef}
          initialSlide={startIndex}
          onSlideChange={(s) => setCurrent(s.activeIndex)}
          modules={[Navigation, Keyboard, Scrollbar]}
          navigation={{
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
          }}
          keyboard={{ enabled: true }}
          scrollbar={{
            hide: true,
          }}
          centeredSlides
          slidesPerView="auto"
          spaceBetween={20}
          className={styles.swiper}
        >
          {items.map((it, i) => (
            <SwiperSlide key={it.key ?? i} className={styles.slide}>
              <img
                src={origUrls[i] || it.url}
                alt={it.key ?? `img-${i}`}
                className={styles.image}
                draggable={false}
              />
            </SwiperSlide>
          ))}

          <div className="swiper-button-prev" aria-hidden="true" />
          <div className="swiper-button-next" aria-hidden="true" />
        </Swiper>
      </div>

      <button onClick={onClose} className={styles.close}>
        ✕
      </button>
    </div>
  );
}
