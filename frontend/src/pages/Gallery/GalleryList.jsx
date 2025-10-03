import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = '/api/gallery';

export default function GalleryList() {
  const [cards, setCards] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    fetch(`${API}/cards`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => setCards([]));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Galleries</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {cards.map((c) => (
          <div
            key={c.prefix}
            onClick={() => nav(`/${c.year}/${c.category}`)}
            style={{
              width: 220,
              cursor: 'pointer',
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: 8,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {c.year} / {c.category}
            </div>
            <div
              style={{
                height: 140,
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {c.thumbnailUrl ? (
                <img
                  src={c.thumbnailUrl}
                  alt=""
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                />
              ) : (
                'No image'
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
