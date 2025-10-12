import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';

import styles from './GalleryList.module.css';

const API = '/api/gallery';

export default function GalleryList() {
  const Title = import.meta.env.VITE_NAME;
  useTitle(Title);

  const { authenticated, loading } = useCheckSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !authenticated) {
      navigate('login');
    }
    console.log('session loading:', loading, 'authenticated:', authenticated);
  }, [loading, authenticated, navigate]);

  const [cards, setCards] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    fetch(`${API}/cards`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => setCards([]));
  }, []);

  return (
    <>
      <div className={styles.Galleries}>
        {cards.map((c) => (
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
    </>
  );
}
