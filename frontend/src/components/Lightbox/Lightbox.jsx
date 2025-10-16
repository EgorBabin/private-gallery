import React, { useEffect, useState, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard, Mousewheel } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';

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

  // preload neighbors (как у тебя было)
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
        })
      );
    })();
  }, [current, items.length, fetchOriginal, origUrls]);

  // Esc закрытие
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // === PINCH HANDLING: allow browser pinch-to-zoom on mobile ===
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // only on touch devices (coarse pointers) — avoids interfering with desktop
    const isTouchDevice = 'ontouchstart' in window || window.matchMedia('(pointer:coarse)').matches;
    if (!isTouchDevice) return;

    let activeTouches = 0;

    const getSwiper = () => swiperRef.current?.swiper;

    const onTouchStart = (e) => {
      activeTouches = e.touches ? e.touches.length : 0;
      // if 2 fingers — start pinch: disable swiper touch handling so browser does page zoom
      if (activeTouches === 2) {
        isTouchingPinchRef.current = true;
        const s = getSwiper();
        if (s) {
          // fully disable touch handling (so browser gesture works)
          s.allowTouchMove = false;
          try { s.mousewheel && s.mousewheel.disable && s.mousewheel.disable(); } catch {}
        }
        // ensure overlay allows browser gestures
        overlay.style.touchAction = 'auto';
        overlay.style.webkitTouchCallout = 'auto';
        overlay.style.webkitUserSelect = 'auto';
      }
    };

    const onTouchEnd = (e) => {
      // touches length after end:
      const remaining = e.touches ? e.touches.length : 0;
      activeTouches = remaining;
      if (isTouchingPinchRef.current && remaining < 2) {
        // pinch finished: restore swiper behavior
        isTouchingPinchRef.current = false;
        const s = getSwiper();
        if (s) {
          s.allowTouchMove = true;
          try { s.mousewheel && s.mousewheel.enable && s.mousewheel.enable(); } catch {}
        }
        // restore overlay restrictions (so your desktop gestures / hover mousewheel logic still works)
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
      // restore if unmounted mid-pinch
      const s = getSwiper();
      if (s) {
        s.allowTouchMove = true;
        try { s.mousewheel && s.mousewheel.enable && s.mousewheel.enable(); } catch {}
      }
      overlay.style.touchAction = '';
      overlay.style.webkitTouchCallout = '';
      overlay.style.webkitUserSelect = '';
    };
  }, [items]);

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
          modules={[Navigation, Keyboard, Mousewheel]}
          navigation={{
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
          }}
          // default: allow touchmove true — pinch logic above will toggle it
          mousewheel={false} // we'll enable mousewheel conditionally elsewhere if needed
          keyboard={{ enabled: true }}
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

      <button onClick={onClose} className={styles.close}>✕</button>
    </div>
  );
}
