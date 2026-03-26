import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { useCheckSession } from '@/hooks/useCheckSession';
import Lightbox from '@/components/Lightbox/Lightbox';
import { useTitle } from '@/hooks/useTitle';
import styles from './GalleryView.module.css';

const API = '/api/gallery';
const LS_KEY = 'gallery_items_cache';
const CARDS_LS_KEY = 'gallery_cards_cache';
const MASONRY_BREAKPOINTS = {
  0: 3,
  760: 4,
  980: 5,
  1200: 6,
};
const MASONRY_GUTTER_BREAKPOINTS = {
  0: '3px',
  760: '5px',
  980: '7px',
};

export default function GalleryView() {
  const { year, category } = useParams();
  const prefix = `${year}/${category}/`;
  const prefixKey = `${year}/${category}`;

  const [items, setItems] = useState([]);
  const [openIndex, setOpenIndex] = useState(-1);

  const [originalUrls, setOriginalUrls] = useState([]);
  const [originalMetas, setOriginalMetas] = useState([]);
  const [cardTitle, setCardTitle] = useState('');

  useTitle(cardTitle ? `${year} ${cardTitle}` : `${year} ${category}`);

  const { authenticated, loading: sessionLoading } = useCheckSession();
  const nav = useNavigate();

  useEffect(() => {
    if (!sessionLoading && !authenticated) {
      nav('/login');
    }
  }, [sessionLoading, authenticated, nav]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const applyCardTitle = (cards) => {
      if (!mounted || !Array.isArray(cards)) {
        return;
      }
      const matched = cards.find((card) => card?.path === prefixKey);
      setCardTitle(matched?.title || '');
    };

    try {
      const raw = localStorage.getItem(CARDS_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        applyCardTitle(parsed?.cards || []);
      }
    } catch (err) {
      void err;
    }

    (async () => {
      try {
        const res = await fetch(`${API}/cards`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.status === 401) {
          nav('/login');
          return;
        }
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        applyCardTitle(data?.cards || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          void err;
        }
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [nav, prefixKey]);

  const pickUrlFromMeta = useCallback((meta) => {
    if (!meta) return null;
    if (typeof meta === 'string') return meta;
    if (meta.url && typeof meta.url === 'string') return meta.url;

    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const width =
      typeof window !== 'undefined' ? (window.innerWidth || 1024) * dpr : 1024;
    const effectiveType =
      (navigator &&
        navigator.connection &&
        navigator.connection.effectiveType) ||
      '';
    const slow = ['slow-2g', '2g', '3g'].includes(effectiveType);

    const orderIfSlow = [
      'preview',
      'screen-1280',
      'screen-1920',
      'screen-2560',
      'original',
    ];
    const orderIfFast = [
      'screen-2560',
      'screen-1920',
      'screen-1280',
      'preview',
      'original',
    ];

    let preferred = null;
    if (width <= 400) preferred = 'preview';
    else if (width <= 1280) preferred = 'screen-1280';
    else if (width <= 1920) preferred = 'screen-1920';
    else preferred = 'screen-2560';

    const getUrl = (k) => {
      const v = meta[k] ?? meta[k.replace('-', '')];
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (v.url) return v.url;
      return null;
    };

    const order = slow
      ? orderIfSlow
      : [preferred, ...orderIfFast.filter((o) => o !== preferred)];

    for (const k of order) {
      const u = getUrl(k);
      if (u) return u;
    }

    const orig =
      getUrl('original') || getUrl('original_photo') || getUrl('orig');
    if (orig) return orig;

    for (const v of Object.values(meta)) {
      if (!v) continue;
      if (typeof v === 'string') return v;
      if (v && v.url) return v.url;
    }
    return null;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          parsed[prefixKey] &&
          Array.isArray(parsed[prefixKey].items) &&
          mounted
        ) {
          const cachedItems = parsed[prefixKey].items;
          setItems(cachedItems);
          setOriginalUrls(new Array(cachedItems.length));
          setOriginalMetas(new Array(cachedItems.length));
        }
      }
    } catch (err) {
      void err;
    }

    (async () => {
      try {
        const res = await fetch(
          `${API}/previews?prefix=${encodeURIComponent(prefix)}`,
          { credentials: 'include', signal: controller.signal },
        );
        if (!mounted) return;
        if (!res.ok) {
          setItems([]);
          setOriginalUrls([]);
          setOriginalMetas([]);
          return;
        }
        const d = await res.json();
        let newItems = d.items || [];

        const getNumericIndexFromKey = (k) => {
          if (!k) return 0;
          const baseWithExt = String(k).split('/').pop();
          const rawBase = baseWithExt
            .replace(/^video_/, '')
            .replace(/\.[^.]+$/, '');
          const m = rawBase.match(/(\d+)$/);
          return m ? Number(m[1]) : 0;
        };

        newItems = newItems.slice().sort((a, b) => {
          const ai = getNumericIndexFromKey(a.key || '');
          const bi = getNumericIndexFromKey(b.key || '');
          if (ai === bi) return (a.key || '').localeCompare(b.key || '');
          return ai - bi;
        });

        setItems(newItems);

        setOriginalUrls((prev) => {
          const arr = new Array(newItems.length);
          for (let i = 0; i < Math.min(prev.length, arr.length); i++)
            arr[i] = prev[i];
          return arr;
        });
        setOriginalMetas((prev) => {
          const arr = new Array(newItems.length);
          for (let i = 0; i < Math.min(prev.length, arr.length); i++)
            arr[i] = prev[i];
          return arr;
        });

        try {
          const rootRaw = localStorage.getItem(LS_KEY);
          const root = rootRaw ? JSON.parse(rootRaw) : {};
          root[prefixKey] = { items: newItems, updatedAt: Date.now() };
          localStorage.setItem(LS_KEY, JSON.stringify(root));
        } catch (err) {
          void err;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (!mounted) return;
        setItems([]);
        setOriginalUrls([]);
        setOriginalMetas([]);
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [prefix, prefixKey]);

  const open = useCallback(
    async (index) => {
      if (index < 0 || index >= items.length) return;
      setOpenIndex(index);

      const needed = [index];
      if (index - 1 >= 0) needed.push(index - 1);
      if (index + 1 < items.length) needed.push(index + 1);

      const fetchedUrls = {};
      const fetchedMetas = {};

      await Promise.all(
        needed.map(async (i) => {
          if (originalUrls[i]) {
            fetchedUrls[i] = originalUrls[i];
            return;
          }
          try {
            const key = items[i].key.replace(/^preview\//, 'original_photo/');
            const r = await fetch(
              `/api/gallery/original?key=${encodeURIComponent(key)}`,
              { credentials: 'include' },
            );
            if (!r.ok) return;
            const jd = await r.json();

            const chosen = pickUrlFromMeta(jd);
            if (chosen) fetchedUrls[i] = chosen;
            fetchedMetas[i] = jd;
          } catch (err) {
            void err;
          }
        }),
      );

      if (
        Object.keys(fetchedUrls).length === 0 &&
        Object.keys(fetchedMetas).length === 0
      )
        return;

      setOriginalUrls((prev) => {
        const copy = prev.slice();
        if (copy.length < items.length) copy.length = items.length;
        for (const k of Object.keys(fetchedUrls))
          copy[Number(k)] = fetchedUrls[k];
        return copy;
      });

      setOriginalMetas((prev) => {
        const copy = prev.slice();
        if (copy.length < items.length) copy.length = items.length;
        for (const k of Object.keys(fetchedMetas))
          copy[Number(k)] = fetchedMetas[k];
        return copy;
      });
    },
    [items, originalUrls, pickUrlFromMeta],
  );

  const fetchOriginal = useCallback(
    async (i) => {
      if (i < 0 || i >= items.length) return null;
      if (originalUrls[i]) return originalUrls[i];
      try {
        const key = items[i].key.replace(/^preview\//, 'original_photo/');
        const res = await fetch(
          `/api/gallery/original?key=${encodeURIComponent(key)}`,
          { credentials: 'include' },
        );
        if (!res.ok) return null;
        const jd = await res.json();
        const chosen = pickUrlFromMeta(jd);
        setOriginalUrls((prev) => {
          const copy = prev.slice();
          if (copy.length < items.length) copy.length = items.length;
          copy[i] = chosen;
          return copy;
        });
        setOriginalMetas((prev) => {
          const copy = prev.slice();
          if (copy.length < items.length) copy.length = items.length;
          copy[i] = jd;
          return copy;
        });
        return chosen;
      } catch {
        return null;
      }
    },
    [items, originalUrls, pickUrlFromMeta],
  );

  return (
    <>
      <h1 className={styles.heading}>
        <span className={styles.headingPath}>
          {year} / {category}
        </span>
        {cardTitle && (
          <span className={styles.headingTitle}> | {cardTitle}</span>
        )}
      </h1>

      <div className={styles.gridWrap}>
        <div className={styles.grid}>
          <ResponsiveMasonry
            columnsCountBreakPoints={MASONRY_BREAKPOINTS}
            gutterBreakPoints={MASONRY_GUTTER_BREAKPOINTS}
          >
            <Masonry>
              {items.length === 0
                ? Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={`skeleton-${i}`}
                      className={`${styles.item} ${styles.skeleton}`}
                      aria-hidden="true"
                    >
                      <div className={styles.skeletonPhoto} />
                    </div>
                  ))
                : items.map((it, idx) => {
                    const key = it.key ?? `${prefix}${idx}`;
                    const isVideo = !!it.isVideo;
                    return (
                      <div
                        key={key}
                        className={styles.item}
                        onClick={() => open(idx)}
                        role="button"
                        tabIndex={0}
                        aria-label={
                          isVideo ? 'Открыть видео' : 'Открыть изображение'
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') open(idx);
                        }}
                      >
                        <img
                          src={it.url}
                          loading="lazy"
                          decoding="async"
                          alt={it.name ?? it.key ?? `${prefix}${idx}`}
                          className={styles.img}
                        />
                        {isVideo && (
                          <div
                            className={styles.playOverlay}
                            aria-hidden="true"
                          >
                            <div className={styles.playBadge}>
                              <Play className={styles.playIcon} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
            </Masonry>
          </ResponsiveMasonry>
        </div>
      </div>

      {openIndex >= 0 && (
        <Lightbox
          startIndex={openIndex}
          items={items}
          originalUrls={originalUrls}
          originalMetas={originalMetas}
          onClose={() => setOpenIndex(-1)}
          fetchOriginal={fetchOriginal}
        />
      )}
    </>
  );
}
