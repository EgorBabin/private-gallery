import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid } from 'react-window';
import Lightbox from '@/components/Lightbox/Lightbox';

const API = '/api/gallery';

export default function GalleryView() {
  const { year, category } = useParams();
  const prefix = `${year}/${category}/`;
  const [items, setItems] = useState([]);
  const [openIndex, setOpenIndex] = useState(-1);
  const [originalUrls, setOriginalUrls] = useState([]);

  useEffect(() => {
    fetch(`${API}/previews?prefix=${encodeURIComponent(prefix)}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]));
  }, [prefix]);

  const open = useCallback(
    async (index) => {
      setOpenIndex(index);
      // build original urls lazily: fetch original signed url for clicked and neighbours
      const needed = [index];
      if (index - 1 >= 0) needed.push(index - 1);
      if (index + 1 < items.length) needed.push(index + 1);

      const urls = [...originalUrls];
      await Promise.all(
        needed.map(async (i) => {
          if (!urls[i]) {
            const key = items[i].key.replace(/^preview\//, 'original/');
            const res = await fetch(
              `/api/gallery/original?key=${encodeURIComponent(key)}`,
              { credentials: 'include' },
            );
            const jd = await res.json();
            urls[i] = jd.url;
          }
        }),
      );
      setOriginalUrls(urls);
    },
    [items, originalUrls],
  );

  const Cell = ({ columnIndex, rowIndex, style, data }) => {
    const idx = rowIndex * data.cols + columnIndex;
    if (idx >= data.items.length) return null;
    const it = data.items[idx];
    return (
      <div style={{ ...style, padding: 6 }} onClick={() => open(idx)}>
        <img
          src={it.url}
          alt={it.key}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: 6,
          }}
          loading="lazy"
        />
      </div>
    );
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <Link to="/">← Back</Link>
        <h2>
          {year} / {category}
        </h2>
      </div>
      <div style={{ flex: 1 }}>
        <AutoSizer>
          {({ height, width }) => {
            const colWidth = 200;
            const cols = Math.max(1, Math.floor(width / colWidth));
            const rowHeight = 160;
            const rows = Math.ceil(items.length / cols);
            return (
              <Grid
                columnCount={cols}
                columnWidth={Math.floor(width / cols)}
                height={height}
                rowCount={rows}
                rowHeight={rowHeight}
                width={width}
                itemData={{ items, cols }}
              >
                {Cell}
              </Grid>
            );
          }}
        </AutoSizer>
      </div>

      {openIndex >= 0 && (
        <Lightbox
          startIndex={openIndex}
          items={items}
          originalUrls={originalUrls}
          onClose={() => setOpenIndex(-1)}
          fetchOriginal={async (i) => {
            if (originalUrls[i]) return originalUrls[i];
            const key = items[i].key.replace(/^preview\//, 'original/');
            const res = await fetch(
              `/api/gallery/original?key=${encodeURIComponent(key)}`,
              { credentials: 'include' },
            );
            const jd = await res.json();
            const newArr = [...originalUrls];
            newArr[i] = jd.url;
            setOriginalUrls(newArr);
            return jd.url;
          }}
        />
      )}
    </div>
  );
}
