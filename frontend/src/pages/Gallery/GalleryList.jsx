import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';

import styles from './GalleryList.module.css';

const API = '/api/gallery';

export default function GalleryList() {
  const Title = import.meta.env.VITE_NAME;
  useTitle(Title);

  const { authenticated, loading: sessionLoading } = useCheckSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!sessionLoading && !authenticated) {
      navigate('login');
    }
  }, [sessionLoading, authenticated, navigate]);

  const [cards, setCards] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    fetch(`${API}/cards`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => {
        setCards([]);
      });
  }, []);

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
      {cards === null
        ? skeletonCards
        : cards.map((c) => (
            <div
              key={c.prefix}
              onClick={() => nav(`/${c.year}/${c.category}`)}
              className={styles.card}
            >
              <h1>{c.category}</h1>
              <div>
                {c.thumbnailUrl ? (
                  <img src={c.thumbnailUrl} alt="" className={styles.photo} />
                ) : (
                  'No image'
                )}
              </div>
              <h2>{c.year}</h2>
            </div>
          ))}
    </div>
  );
}
