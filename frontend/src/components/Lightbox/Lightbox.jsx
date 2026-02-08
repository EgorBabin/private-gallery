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

  useEffect(() => setCurrent(startIndex), [startIndex]);
  useEffect(() => {
    setMetas(new Array(items.length));
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
      } catch (e) {
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
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    let stale = false;
    const toLoad = [current - 1, current, current + 1];
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
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          {items.map((it, i) => {
            const shouldRender = Math.abs(i - current) <= RENDER_RADIUS;
            const meta = metas[i];
            const srcFallback =
              (meta && (meta.preview?.url || meta.url)) || it.url;
            const srcSet = buildSrcSet(meta);
            const isVideo = !!(meta?.isVideo || it.isVideo);

            return (
              <SwiperSlide key={it.key ?? i} className={styles.slide}>
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

                        {meta && meta.videos
                          ? (() => {
                              const vids = gatherVideoUrls(meta);
                              if (vids.length === 0) return null;
                              const best = vids[0];
                              return (
                                <a
                                  className={styles.download}
                                  href={best.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  aria-label="Скачать видео"
                                  onClick={(e) => {}}
                                >
                                  <Hd />
                                </a>
                              );
                            })()
                          : null}
                      </div>
                    ) : srcSet ? (
                      <picture>
                        <source srcSet={srcSet} sizes={sizesAttr} />
                        <img
                          src={srcFallback}
                          alt={it.key ?? `img-${i}`}
                          className={styles.image}
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                        />
                      </picture>
                    ) : (
                      <img
                        src={srcFallback}
                        alt={it.key ?? `img-${i}`}
                        className={styles.image}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                      />
                    )}

                    {meta &&
                    (meta.original?.url || typeof meta.original === 'string') &&
                    !isVideo ? (
                      <a
                        className={styles.download}
                        href={meta.original?.url || meta.original}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <Hd />
                      </a>
                    ) : null}
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

      <button onClick={onClose} className={styles.close} aria-label="Закрыть">
        <X />
      </button>
    </div>
  );
}
