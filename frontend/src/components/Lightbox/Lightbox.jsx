import React, { useEffect, useState, useRef } from 'react';
import { Hd, X } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard, Scrollbar } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/scrollbar';

import styles from './Lightbox.module.css';

const API_ORIGINAL = '/api/gallery/original';

export default function Lightbox({
  items,
  startIndex = 0,
  onClose,
  fetchOriginal,
}) {
  const [current, setCurrent] = useState(startIndex);
  const [metas, setMetas] = useState(() => new Array(items.length));
  const swiperRef = useRef(null);
  const overlayRef = useRef(null);
  const preloadedSlidesRef = useRef(new Set());
  const loadingSlidesRef = useRef(new Set());

  useEffect(() => setCurrent(startIndex), [startIndex]);
  useEffect(() => {
    setMetas(new Array(items.length));
    preloadedSlidesRef.current.clear();
    loadingSlidesRef.current.clear();
  }, [items]);

  const setMetaAt = (index, meta) => {
    setMetas((prev) => {
      const copy = prev ? prev.slice() : new Array(items.length);
      copy[index] = meta;
      return copy;
    });
  };

  const fetchMeta = async (index) => {
    if (index < 0 || index >= items.length) return null;
    if (metas[index]) return metas[index];

    if (typeof fetchOriginal === 'function') {
      try {
        const maybe = await fetchOriginal(index);
        if (maybe && typeof maybe === 'object') {
          setMetaAt(index, maybe);
          return maybe;
        }
      } catch {
        // ignore and fallback to API
      }
    }

    try {
      const previewKey = items[index].key; // e.g. 'preview/2023/event/video_10.webp' or 'preview/.../10.webp'
      const rel = previewKey.replace(/^preview\//, '');
      const baseNoExt = rel.replace(/\.[^.]+$/, '');
      const originalKey = `original_photo/${baseNoExt}.jpg`;
      const r = await fetch(
        `${API_ORIGINAL}?key=${encodeURIComponent(originalKey)}`,
        {
          credentials: 'include',
        },
      );
      if (!r.ok) {
        return null;
      }
      const jd = await r.json();
      if (!jd) return null;
      setMetaAt(index, jd);
      return jd;
    } catch {
      return null;
    }
  };

  const preloadSlide = async (index) => {
    if (index < 0 || index >= items.length) return;
    if (preloadedSlidesRef.current.has(index)) return;
    if (loadingSlidesRef.current.has(index)) return;

    const item = items[index];
    if (!item || item.isVideo || !item.url) {
      preloadedSlidesRef.current.add(index);
      return;
    }

    loadingSlidesRef.current.add(index);
    try {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = item.url;
        if (img.complete) resolve();
      });
    } finally {
      loadingSlidesRef.current.delete(index);
      preloadedSlidesRef.current.add(index);
    }
  };

  useEffect(() => {
    let stale = false;
    const toLoad = [
      current,
      current - 1,
      current + 1,
      current - 2,
      current + 2,
    ];
    (async () => {
      for (const i of toLoad) {
        if (i < 0 || i >= items.length) continue;
        if (metas[i]) continue;
        await fetchMeta(i);
        if (stale) return;
      }
    })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, items.length]);

  useEffect(() => {
    let stale = false;
    const queue = [current, current - 1, current + 1, current - 2, current + 2];

    (async () => {
      for (const i of queue) {
        if (stale) return;
        if (i < 0 || i >= items.length) continue;
        await preloadSlide(i);
      }
    })();

    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, items.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const { body, documentElement } = document;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = documentElement.style.overflow;
    const prevBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = prevBodyOverflow;
      documentElement.style.overflow = prevHtmlOverflow;
      body.style.paddingRight = prevBodyPaddingRight;
    };
  }, []);

  const RENDER_RADIUS = 2;

  const buildSrcSet = (meta) => {
    if (!meta) return null;
    const order = [
      { key: 'screen-2560', w: 2560 },
      { key: 'screen-1920', w: 1920 },
      { key: 'screen-1280', w: 1280 },
    ];
    const parts = [];
    for (const o of order) {
      const v = meta[o.key] ?? meta[o.key.replace('-', '')];
      const url = typeof v === 'string' ? v : v?.url;
      if (url) parts.push(`${url} ${o.w}w`);
    }
    return parts.length ? parts.join(', ') : null;
  };

  const sizesAttr =
    '(max-width:480px) 400px, (max-width:1280px) 1280px, (max-width:1920px) 1920px, 2560px';

  const gatherVideoUrls = (meta) => {
    if (!meta || !meta.videos) return [];
    const order = ['1440', '1080', '720'];
    const out = [];
    for (const q of order) {
      const v = meta.videos[q];
      const url = typeof v === 'string' ? v : v?.url;
      if (url) out.push({ res: q, url, key: v?.key || null });
    }
    return out;
  };

  const getOriginalPhotoUrl = (meta) => {
    if (!meta) return null;
    const original = meta.original ?? meta.original_photo ?? meta.orig;
    if (!original) return null;
    return typeof original === 'string' ? original : original.url || null;
  };

  const currentMeta = metas[current];
  const currentItem = items[current];
  const currentIsVideo = !!(currentMeta?.isVideo || currentItem?.isVideo);
  const currentBestVideo = currentIsVideo
    ? gatherVideoUrls(currentMeta)[0]
    : null;
  const currentDownloadHref = currentIsVideo
    ? currentBestVideo?.url || null
    : getOriginalPhotoUrl(currentMeta);
  const currentDownloadLabel = currentIsVideo
    ? 'Скачать видео'
    : 'Скачать оригинал';

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
          breakpoints={{
            0: { spaceBetween: 8 },
            600: { spaceBetween: 12 },
            1200: { spaceBetween: 20 },
          }}
          className={styles.swiper}
        >
          {items.map((it, i) => {
            const distance = Math.abs(i - current);
            const shouldRender = distance <= RENDER_RADIUS;
            const meta = metas[i];
            const srcFallback =
              (meta && (meta.preview?.url || meta.url)) || it.url;
            const srcSet = buildSrcSet(meta);
            const isVideo = !!(meta?.isVideo || it.isVideo);
            const slideStateClass =
              distance === 0 ? styles.slideActive : styles.slideSide;

            return (
              <SwiperSlide
                key={it.key ?? i}
                className={`${styles.slide} ${slideStateClass}`}
              >
                {shouldRender ? (
                  <>
                    {isVideo ? (
                      <div className={styles.videoWrap}>
                        {(() => {
                          const vids = gatherVideoUrls(meta);
                          if (vids.length === 0) {
                            return (
                              <video
                                key={`video-fallback-${it.key || i}`}
                                className={styles.video}
                                controls
                                preload="metadata"
                                playsInline
                                poster={meta?.preview?.url || it.url}
                              >
                                Ваш браузер не поддерживает видео.
                              </video>
                            );
                          }

                          const videoKey = vids.map((v) => v.url).join(',');
                          return (
                            <video
                              key={videoKey}
                              className={styles.video}
                              controls
                              preload="metadata"
                              playsInline
                              poster={meta?.preview?.url || it.url}
                              // allow downloads / cross-origin if signed urls require it
                              crossOrigin="anonymous"
                            >
                              {vids.map((v) => {
                                const lower = String(v.url).toLowerCase();
                                const type = lower.endsWith('.webm')
                                  ? 'video/webm'
                                  : lower.endsWith('.ogg')
                                    ? 'video/ogg'
                                    : 'video/mp4';
                                if (!v.url) {
                                  console.warn(
                                    'Empty video url for',
                                    it.key,
                                    v,
                                  );
                                  return null;
                                }
                                return (
                                  <source
                                    key={v.res}
                                    src={v.url}
                                    type={type}
                                    data-res={v.res}
                                  />
                                );
                              })}
                              Ваш браузер не поддерживает видео.
                            </video>
                          );
                        })()}
                      </div>
                    ) : srcSet ? (
                      <picture className={styles.picture}>
                        <source srcSet={srcSet} sizes={sizesAttr} />
                        <img
                          src={srcFallback}
                          alt={it.key ?? `img-${i}`}
                          className={styles.image}
                          draggable={false}
                          loading="eager"
                          decoding="async"
                        />
                      </picture>
                    ) : (
                      <img
                        src={srcFallback}
                        alt={it.key ?? `img-${i}`}
                        className={styles.image}
                        draggable={false}
                        loading="eager"
                        decoding="async"
                      />
                    )}
                  </>
                ) : (
                  <div className={styles.placeholder} aria-hidden="true" />
                )}
              </SwiperSlide>
            );
          })}

          <div className="swiper-button-prev" aria-hidden="true" />
          <div className="swiper-button-next" aria-hidden="true" />
        </Swiper>
      </div>

      {currentDownloadHref ? (
        <a
          className={styles.download}
          href={currentDownloadHref}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={currentDownloadLabel}
          onClick={(e) => e.stopPropagation()}
        >
          <Hd />
        </a>
      ) : null}

      <button onClick={onClose} className={styles.close} aria-label="Закрыть">
        <X />
      </button>
    </div>
  );
}
