import React, { useEffect, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';

// props: items (previews), startIndex, onClose, fetchOriginal(index) -> url
export default function Lightbox({
  items,
  startIndex,
  onClose,
  fetchOriginal,
}) {
  const [current, setCurrent] = useState(startIndex);
  const [origUrls, setOrigUrls] = useState([]);

  useEffect(() => {
    setCurrent(startIndex);
  }, [startIndex]);

  useEffect(() => {
    // preload current and neighbors
    (async () => {
      await Promise.all(
        [current, current - 1, current + 1].map(async (i) => {
          if (i >= 0 && i < items.length && !origUrls[i]) {
            const url = await fetchOriginal(i);
            setOrigUrls((prev) => {
              const copy = [...prev];
              copy[i] = url;
              return copy;
            });
          }
        }),
      );
    })();
  }, [current]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.9)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{ width: '90%', height: '90%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Swiper
          initialSlide={startIndex}
          onSlideChange={(s) => setCurrent(s.activeIndex)}
          navigation
          keyboard={{ enabled: true }}
          spaceBetween={10}
        >
          {items.map((it, i) => (
            <SwiperSlide
              key={it.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={origUrls[i] || it.url}
                alt={it.key}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          fontSize: 20,
          color: '#000000ff',
        }}
      >
        ✕
      </button>
    </div>
  );
}
