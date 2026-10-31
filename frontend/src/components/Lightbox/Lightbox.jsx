import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Hd, X } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Keyboard, Navigation, Virtual } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/virtual';

import styles from './Lightbox.module.css';

const API_ORIGINAL = '/api/gallery/original';
// сколько слайдов вокруг текущего держать в DOM и сколько метаданных грузить заранее
const VIRTUAL_BUFFER = 1;
const PREFETCH_RADIUS = 1;
// догружаем следующую страницу галереи, когда до конца осталось столько слайдов
const LOAD_MORE_THRESHOLD = 4;
const SCREEN_SIZES = [1280, 1920, 2560];
const VIDEO_SIZES = ['1440', '1080', '720'];
const IMAGE_SIZES = '(min-width: 900px) 78vw, 88vw';

function urlOf(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.url || null;
}

function buildSrcSet(item, meta) {
  const parts = [];
  if (item.url) parts.push(`${item.url} 400w`);
  for (const size of SCREEN_SIZES) {
    const url = urlOf(meta?.[`screen${size}`] ?? meta?.[`screen-${size}`]);
    if (url) parts.push(`${url} ${size}w`);
  }
  return parts.length > 1 ? parts.join(', ') : undefined;
}

function gatherVideoUrls(meta) {
  if (!meta?.videos) return [];
  return VIDEO_SIZES.map((res) => ({
    res,
    url: urlOf(meta.videos[res]),
  })).filter((v) => v.url);
}

function getDownloadHref(item, meta) {
  if (!meta) return null;
  if (meta.isVideo || item.isVideo)
    return gatherVideoUrls(meta)[0]?.url || null;
  return urlOf(meta.original ?? meta.original_photo ?? meta.orig);
}

const LightboxSlide = memo(function LightboxSlide({ item, meta }) {
  const isVideo = !!(meta?.isVideo || item.isVideo);
  const poster = urlOf(meta?.preview) || item.url;

  if (isVideo) {
    const videos = gatherVideoUrls(meta);
    return (
      <div className={styles.videoWrap}>
        <video
          key={videos.map((v) => v.url).join(',') || 'pending'}
          className={styles.video}
          controls
          preload="metadata"
          playsInline
          poster={poster}
          crossOrigin="anonymous"
        >
          {videos.map((v) => (
            <source key={v.res} src={v.url} type="video/mp4" data-res={v.res} />
          ))}
          Ваш браузер не поддерживает видео.
        </video>
      </div>
    );
  }

  const hasSize = item.width > 0 && item.height > 0;
  // пока метаданные грузятся, показываем уже закэшированное превью,
  // затем браузер сам выбирает размер из srcset
  return (
    <img
      src={urlOf(meta?.screen1280) || item.url}
      srcSet={buildSrcSet(item, meta)}
      sizes={IMAGE_SIZES}
      width={hasSize ? item.width : undefined}
      height={hasSize ? item.height : undefined}
      alt={item.name ?? ''}
      className={styles.image}
      draggable={false}
      decoding="async"
    />
  );
});

export default function Lightbox({
  items,
  startIndex = 0,
  onClose,
  hasMore = false,
  onNeedMore,
}) {
  const [current, setCurrent] = useState(startIndex);
  const metaCacheRef = useRef(new Map());
  const inflightRef = useRef(new Set());
  const [, setMetaVersion] = useState(0);

  const loadMeta = useCallback((item) => {
    if (!item?.key) return;
    const cache = metaCacheRef.current;
    const inflight = inflightRef.current;
    if (cache.has(item.key) || inflight.has(item.key)) return;

    inflight.add(item.key);
    const originalKey = item.key.replace(/^preview\//, 'original_photo/');
    fetch(`${API_ORIGINAL}?key=${encodeURIComponent(originalKey)}`, {
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => {
        if (!meta) return;
        cache.set(item.key, meta);
        setMetaVersion((v) => v + 1);
      })
      .catch(() => {})
      .finally(() => inflight.delete(item.key));
  }, []);

  useEffect(() => {
    for (let d = 0; d <= PREFETCH_RADIUS; d += 1) {
      loadMeta(items[current + d]);
      if (d > 0) loadMeta(items[current - d]);
    }
    if (hasMore && current >= items.length - LOAD_MORE_THRESHOLD) {
      onNeedMore?.();
    }
  }, [current, items, hasMore, onNeedMore, loadMeta]);

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

  const currentItem = items[current];
  const currentMeta = currentItem
    ? metaCacheRef.current.get(currentItem.key)
    : null;
  const downloadHref = currentItem
    ? getDownloadHref(currentItem, currentMeta)
    : null;
  const downloadLabel =
    currentMeta?.isVideo || currentItem?.isVideo
      ? 'Скачать видео'
      : 'Скачать оригинал';

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* В DOM только текущий слайд и соседи: открытие и свайп не зависят
            от размера папки */}
        <Swiper
          modules={[Virtual, Keyboard, Navigation]}
          virtual={{
            addSlidesBefore: VIRTUAL_BUFFER,
            addSlidesAfter: VIRTUAL_BUFFER,
          }}
          initialSlide={startIndex}
          onSlideChange={(s) => setCurrent(s.activeIndex)}
          navigation={{
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
          }}
          keyboard={{ enabled: true }}
          centeredSlides
          slidesPerView={1.14}
          spaceBetween={8}
          breakpoints={{
            600: { slidesPerView: 1.2, spaceBetween: 12 },
            900: { slidesPerView: 1.28, spaceBetween: 20 },
          }}
          className={styles.swiper}
        >
          {items.map((item, i) => (
            <SwiperSlide
              key={item.key ?? i}
              virtualIndex={i}
              className={styles.slide}
            >
              <LightboxSlide
                item={item}
                meta={metaCacheRef.current.get(item.key)}
              />
            </SwiperSlide>
          ))}
        </Swiper>
        <div className="swiper-button-prev" aria-hidden="true" />
        <div className="swiper-button-next" aria-hidden="true" />
      </div>

      {downloadHref ? (
        <a
          className={styles.download}
          href={downloadHref}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={downloadLabel}
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
