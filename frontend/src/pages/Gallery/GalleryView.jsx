import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import Lightbox from '@/components/Lightbox/Lightbox';
import { useTitle } from '@/hooks/useTitle';
import styles from './GalleryView.module.css';

const API = '/api/gallery';

export default function GalleryView() {
  const { year, category } = useParams();
  const prefix = `${year}/${category}/`;
  const [items, setItems] = useState([]);
  const [openIndex, setOpenIndex] = useState(-1);
  const [originalUrls, setOriginalUrls] = useState([]);
  const scrollRef = useRef(null);

  useTitle(category);

  // fetch previews
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

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
          return;
        }
        const d = await res.json();
        const newItems = d.items || [];
        setItems(newItems);
        setOriginalUrls((prev) => {
          const arr = new Array(newItems.length);
          for (let i = 0; i < Math.min(prev.length, arr.length); i++)
            arr[i] = prev[i];
          return arr;
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!mounted) return;
        setItems([]);
        setOriginalUrls([]);
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [prefix]);

  // lazy-load images via IntersectionObserver
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img[data-src]'));
    if (!imgs.length) return;

    const obs = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          const img = ent.target;
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            img.removeAttribute('data-src');
          }
          obs.unobserve(img);
        }
      }
    });

    imgs.forEach((i) => obs.observe(i));
    return () => obs.disconnect();
  }, [items]);

  const open = useCallback(
    async (index) => {
      if (index < 0 || index >= items.length) return;
      setOpenIndex(index);

      // предзагрузить соседей
      const needed = [index];
      if (index - 1 >= 0) needed.push(index - 1);
      if (index + 1 < items.length) needed.push(index + 1);

      const fetched = {};
      await Promise.all(
        needed.map(async (i) => {
          if (originalUrls[i]) {
            fetched[i] = originalUrls[i];
            return;
          }
          try {
            const key = items[i].key.replace(/^preview\//, 'original_photo/');
            const r = await fetch(
              `/api/gallery/original?key=${encodeURIComponent(key)}`,
              {
                credentials: 'include',
              },
            );
            if (!r.ok) return;
            const jd = await r.json();
            if (jd?.url) fetched[i] = jd.url;
            // eslint-disable-next-line no-unused-vars
          } catch (e) {
            // ignore
          }
        }),
      );

      if (Object.keys(fetched).length === 0) return;

      setOriginalUrls((prev) => {
        const copy = prev.slice();
        if (copy.length < items.length) copy.length = items.length;
        for (const k of Object.keys(fetched)) copy[Number(k)] = fetched[k];
        return copy;
      });
    },
    [items, originalUrls],
  );

  const fetchOriginal = useCallback(
    async (i) => {
      if (i < 0 || i >= items.length) return null;
      if (originalUrls[i]) return originalUrls[i];
      try {
        const key = items[i].key.replace(/^preview\//, 'original_photo/');
        const res = await fetch(
          `/api/gallery/original?key=${encodeURIComponent(key)}`,
          {
            credentials: 'include',
          },
        );
        if (!res.ok) return null;
        const jd = await res.json();
        if (!jd?.url) return null;
        setOriginalUrls((prev) => {
          const copy = prev.slice();
          if (copy.length < items.length) copy.length = items.length;
          copy[i] = jd.url;
          return copy;
        });
        return jd.url;
      } catch {
        return null;
      }
    },
    [items, originalUrls],
  );

  return (
    <>
      <h1>
        {year} / {category}
      </h1>

      <div className={styles.gridWrap} ref={scrollRef}>
        {items.length === 0 ? (
          <div className={styles.grid}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className={`${styles.item} ${styles.skeleton}`}
                aria-hidden="true"
              >
                <div className={styles.skeletonPhoto} />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.grid}>
            {items.map((it, idx) => {
              const key = it.key ?? `${prefix}${idx}`;
              return (
                <div
                  key={key}
                  className={styles.item}
                  onClick={() => open(idx)}
                  role="button"
                  tabIndex={0}
                >
                  <img
                    data-src={it.url}
                    alt={it.key || `img-${idx}`}
                    className={styles.img}
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.opacity = '0.6';
                      e.currentTarget.style.filter = 'grayscale(1)';
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openIndex >= 0 && (
        <Lightbox
          startIndex={openIndex}
          items={items}
          originalUrls={originalUrls}
          onClose={() => setOpenIndex(-1)}
          fetchOriginal={fetchOriginal}
        />
      )}
    </>
  );
}
