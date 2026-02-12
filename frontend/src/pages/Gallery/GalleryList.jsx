import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';
import styles from './GalleryList.module.css';
import { Images } from 'lucide-react';

const API = '/api/gallery';
const LS_KEY = 'gallery_cards_cache';

function sortCardsDesc(list) {
  return (Array.isArray(list) ? list : [])
    .slice()
    .sort(
      (a, b) =>
        Number(b?.sortOrder || 0) - Number(a?.sortOrder || 0) ||
        Number(b?.id || 0) - Number(a?.id || 0),
    );
}

export default function GalleryList() {
  const Title = import.meta.env.VITE_NAME;
  useTitle(Title);

  const { authenticated, loading: sessionLoading } = useCheckSession();
  const nav = useNavigate();

  useEffect(() => {
    if (!sessionLoading && !authenticated) {
      nav('/login');
    }
  }, [sessionLoading, authenticated, nav]);

  const [cards, setCards] = useState(null);
  const [imageAllCount, setImageAllCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.cards) && mounted) {
          const cachedCards = sortCardsDesc(parsed.cards);
          setCards(cachedCards);
          setImageAllCount(
            cachedCards.reduce((sum, c) => sum + (c.imageCount || 0), 0),
          );
        }
      } catch (err) {
        void err;
      }
    }

    fetch(`${API}/cards`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((res) => {
        if (res.status === 401) {
          nav('/login');
          return null;
        }
        if (!res.ok) throw new Error('Network');
        return res.json();
      })
      .then((d) => {
        if (!d || !mounted) return;
        const fresh = sortCardsDesc(d.cards || []);
        setCards(fresh);
        setImageAllCount(
          fresh.reduce((sum, c) => sum + (c.imageCount || 0), 0),
        );
        localStorage.setItem(LS_KEY, JSON.stringify({ cards: fresh }));
      })
      .catch((err) => {
        void err;
      });

    return () => {
      mounted = false;
    };
  }, [nav]);

  const skeletonCount = 6;
  const skeletonCards = Array.from({ length: skeletonCount }, (_, i) => (
    <div
      key={`skeleton-${i}`}
      className={`${styles.card} ${styles.skeleton}`}
      aria-hidden="true"
    >
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonPhoto} />
      <div className={styles.skeletonYear} />
    </div>
  ));

  return (
    <div className={styles.Galleries}>
      {cards && (
        <div className={styles.stats}>
          <Images /> {imageAllCount}
        </div>
      )}
      {cards === null
        ? skeletonCards
        : cards.map((c) => {
            const cardPath = c.path || `${c.year}/${c.category}`;
            return (
              <div
                key={c.id || cardPath || c.prefix}
                onClick={() => nav(`/${cardPath}`)}
                className={styles.card}
              >
                <h1>{c.title || c.category}</h1>
                <div>
                  {c.thumbnailUrl && (
                    <img src={c.thumbnailUrl} alt="" className={styles.photo} />
                  )}
                </div>
                <h2>
                  {c.year}{' '}
                  <span className={styles.imageCount}>— {c.imageCount}</span>
                </h2>
              </div>
            );
          })}
    </div>
  );
}
