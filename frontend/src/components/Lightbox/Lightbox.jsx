import React, { useEffect, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard, Mousewheel } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';

import styles from './Lightbox.module.css';

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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <Swiper
          initialSlide={startIndex}
          onSlideChange={(s) => setCurrent(s.activeIndex)}
          modules={[Navigation, Keyboard, Mousewheel]}
          navigation
          mousewheel={true}
          keyboard={{ enabled: true }}
          spaceBetween={10}
          className={styles.swiper}
        >
          {items.map((it, i) => (
            <SwiperSlide key={it.key} className={styles.slide}>
              <img
                src={origUrls[i] || it.url}
                alt={it.key}
                className={styles.image}
              />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
      <button onClick={onClose} className={styles.close}>
        ✕
      </button>
    </div>
  );
}
