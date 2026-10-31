import React, {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useTitle } from '@/hooks/useTitle';
import styles from './GalleryView.module.css';

const Lightbox = lazy(() => import('@/components/Lightbox/Lightbox'));

const API = '/api/gallery';
const LS_KEY = 'gallery_items_cache_v2';
const LS_MAX_FOLDERS = 8;
// подписанные ссылки стабильны 1 час (S3_SIGNED_URL_WINDOW_SEC) и живут
// минимум ещё час после получения: кэш моложе часа всегда с рабочими ссылками
const LS_MAX_AGE_MS = 50 * 60 * 1000;
const PAGE_SIZE = 120;
const LOAD_MORE_MARGIN = '1500px';
const COLUMN_BREAKPOINTS = [
  [1200, 6],
  [980, 5],
  [760, 4],
  [0, 3],
];
const GUTTER_BREAKPOINTS = [
  [980, 7],
  [760, 5],
  [0, 3],
];
const SKELETON_COUNT = 12;

// старый формат кэша хранил все папки с протухшими ссылками
try {
  localStorage.removeItem('gallery_items_cache');
} catch {
  // localStorage недоступен
}

function pickByWidth(breakpoints, width) {
  for (const [minWidth, value] of breakpoints) {
    if (width >= minWidth) return value;
  }
  return breakpoints[breakpoints.length - 1][1];
}

function readCache(prefixKey) {
  try {
    const root = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const entry = root[prefixKey];
    if (!entry || !Array.isArray(entry.items)) return null;
    if (Date.now() - Number(entry.updatedAt || 0) > LS_MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(prefixKey, entry) {
  try {
    const root = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    root[prefixKey] = { ...entry, updatedAt: Date.now() };
    const keep = Object.entries(root)
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      .slice(0, LS_MAX_FOLDERS);
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    // переполнение или запрет localStorage не критичны
  }
}

// Число колонок меняется только на брейкпоинтах: появление адресной строки
// на телефоне (resize по высоте) не перерисовывает сетку.
function useColumnLayout(containerRef) {
  const [layout, setLayout] = useState(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
    return {
      columns: pickByWidth(COLUMN_BREAKPOINTS, width),
      gutter: pickByWidth(GUTTER_BREAKPOINTS, width),
    };
  });

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      const columns = pickByWidth(COLUMN_BREAKPOINTS, width);
      const gutter = pickByWidth(GUTTER_BREAKPOINTS, width);
      setLayout((prev) =>
        prev.columns === columns && prev.gutter === gutter
          ? prev
          : { columns, gutter },
      );
    };
    const node = containerRef.current;
    if (typeof ResizeObserver === 'undefined' || !node) {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  return layout;
}

// Раскладка по самой короткой колонке по известным пропорциям: порядок
// уже размещённых элементов не меняется при догрузке следующих страниц.
function buildColumns(items, columnCount) {
  const columns = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);
  items.forEach((item, index) => {
    const ratio =
      item.width > 0 && item.height > 0 ? item.height / item.width : 1;
    let target = 0;
    for (let c = 1; c < columnCount; c += 1) {
      if (heights[c] < heights[target]) target = c;
    }
    columns[target].push(index);
    heights[target] += ratio;
  });
  return columns;
}

const GridItem = memo(function GridItem({ item, index, onOpen }) {
  const hasSize = item.width > 0 && item.height > 0;
  const isVideo = !!item.isVideo;
  return (
    <div
      className={styles.item}
      style={hasSize ? { aspectRatio: `${item.width} / ${item.height}` } : null}
      onClick={() => onOpen(index)}
      role="button"
      tabIndex={0}
      aria-label={isVideo ? 'Открыть видео' : 'Открыть изображение'}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(index);
      }}
    >
      {item.url && (
        <img
          src={item.url}
          width={hasSize ? item.width : undefined}
          height={hasSize ? item.height : undefined}
          loading="lazy"
          decoding="async"
          alt={item.name ?? ''}
          className={hasSize ? styles.imgFill : styles.img}
        />
      )}
      {isVideo && (
        <div className={styles.playOverlay} aria-hidden="true">
          <div className={styles.playBadge}>
            <Play className={styles.playIcon} />
          </div>
        </div>
      )}
    </div>
  );
});

export default function GalleryView() {
  const { year, category } = useParams();
  const prefixKey = `${year}/${category}`;
  const location = useLocation();
  const nav = useNavigate();

  const [items, setItems] = useState(() => readCache(prefixKey)?.items || []);
  const [cardTitle, setCardTitle] = useState(
    () => readCache(prefixKey)?.title || '',
  );
  const [nextOffset, setNextOffset] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const loadingMoreRef = useRef(false);
  const gridRef = useRef(null);
  const sentinelRef = useRef(null);
  const openedHereRef = useRef(false);

  useTitle(cardTitle ? `${year} ${cardTitle}` : `${year} ${category}`);

  const { columns: columnCount, gutter } = useColumnLayout(gridRef);
  const columns = useMemo(
    () => buildColumns(items, columnCount),
    [items, columnCount],
  );

  const fetchPage = useCallback(
    async (offset, signal) => {
      const params = new URLSearchParams({
        prefix: `${prefixKey}/`,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`${API}/previews?${params}`, {
        credentials: 'include',
        signal,
      });
      if (res.status === 401) {
        nav('/login');
        return null;
      }
      if (!res.ok) throw new Error(`previews ${res.status}`);
      return res.json();
    },
    [prefixKey, nav],
  );

  // первая страница: показываем кэш сразу, затем заменяем свежими данными
  useEffect(() => {
    const controller = new AbortController();
    const cached = readCache(prefixKey);
    setItems(cached?.items || []);
    setCardTitle(cached?.title || '');
    setNextOffset(null);
    setLoaded(false);

    fetchPage(0, controller.signal)
      .then((data) => {
        if (!data) return;
        const fresh = data.items || [];
        setItems(fresh);
        setNextOffset(data.nextOffset ?? null);
        setCardTitle(data.title || '');
        setLoaded(true);
        writeCache(prefixKey, { items: fresh, title: data.title || '' });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setLoaded(true);
      });

    return () => controller.abort();
  }, [prefixKey, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!loaded || nextOffset === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const data = await fetchPage(nextOffset);
      if (!data) return;
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.key));
        return prev.concat(
          (data.items || []).filter((item) => !seen.has(item.key)),
        );
      });
      setNextOffset(data.nextOffset ?? null);
    } catch {
      // следующая попытка при следующем пересечении
    } finally {
      loadingMoreRef.current = false;
    }
  }, [loaded, nextOffset, fetchPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || nextOffset === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: LOAD_MORE_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, nextOffset]);

  // открытый лайтбокс хранится в истории: кнопка «назад» на телефоне
  // закрывает его, а не уводит со страницы
  const rawOpenIndex = location.state?.lightbox;
  const openIndex =
    Number.isInteger(rawOpenIndex) && rawOpenIndex < items.length
      ? rawOpenIndex
      : -1;

  const open = useCallback(
    (index) => {
      openedHereRef.current = true;
      nav(location.pathname, { state: { lightbox: index } });
    },
    [nav, location.pathname],
  );

  const close = useCallback(() => {
    if (openedHereRef.current) {
      openedHereRef.current = false;
      nav(-1);
    } else {
      nav(location.pathname, { replace: true, state: null });
    }
  }, [nav, location.pathname]);

  const showSkeleton = items.length === 0 && !loaded;

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
        <div
          ref={gridRef}
          className={styles.grid}
          style={{ gap: `${gutter}px` }}
        >
          {showSkeleton
            ? Array.from({ length: columnCount }, (_, c) => (
                <div
                  key={c}
                  className={styles.column}
                  style={{ gap: `${gutter}px` }}
                >
                  {Array.from(
                    { length: Math.ceil(SKELETON_COUNT / columnCount) },
                    (_, i) => (
                      <div
                        key={i}
                        className={`${styles.item} ${styles.skeleton}`}
                        aria-hidden="true"
                      />
                    ),
                  )}
                </div>
              ))
            : columns.map((indexes, c) => (
                <div
                  key={c}
                  className={styles.column}
                  style={{ gap: `${gutter}px` }}
                >
                  {indexes.map((index) => (
                    <GridItem
                      key={items[index].key}
                      item={items[index]}
                      index={index}
                      onOpen={open}
                    />
                  ))}
                </div>
              ))}
        </div>
        {nextOffset !== null && (
          <div
            ref={sentinelRef}
            className={styles.sentinel}
            aria-hidden="true"
          />
        )}
      </div>

      {openIndex >= 0 && (
        <Suspense fallback={null}>
          <Lightbox
            startIndex={openIndex}
            items={items}
            onClose={close}
            hasMore={nextOffset !== null}
            onNeedMore={loadMore}
          />
        </Suspense>
      )}
    </>
  );
}
