import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CornerLeftUp,
  CornerRightDown,
  Clock3,
  GripVertical,
  Play,
  Trash2,
  Undo2,
} from 'lucide-react';
import { sileo } from 'sileo';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { useCheckSession } from '@/hooks/useCheckSession';
import { parseApiResponse } from '@/utils/apiResponse';
import { notify, notifyError, notifyLoading } from '@/utils/notifications';
import styles from './GalleryEdit.module.css';

const CARDS_API = '/api/gallery/cards-admin';
const PREVIEWS_API = '/api/gallery/previews';
const REORDER_API = '/api/gallery/reorder';
const REORDER_STATUS_API = '/api/gallery/reorder-status';
const MEDIA_SOFT_DELETE_API = '/api/gallery/media-soft-delete';
const PENDING_DELETIONS_API = '/api/gallery/pending-deletions';
const CATEGORY_RE = /^[A-Za-z]+$/;
const CARD_PATH_RE = /^\d{1,4}\/[A-Za-z]+$/;
const REORDER_POLL_DELAY_MS = 2000;
const REORDER_POLL_ATTEMPTS = 180;
const REORDER_STAGE_MESSAGES = {
  queued: 'Задача поставлена в очередь',
  starting: 'Подготавливаем переименование фотографий',
  processing: 'Обрабатываем задачу',
  'staging-temp': 'Перемещаем фотографии во временную область',
  'writing-targets': 'Применяем новый порядок фотографий',
  retrying: 'Повторяем шаг после проверки hash',
  completed: 'Переименование завершено',
  done: 'Переименование завершено',
  failed: 'Не удалось завершить переименование',
  error: 'Ошибка переименования фотографий',
};

function validationError(message) {
  const err = new Error(message);
  err.status = 'warning';
  return err;
}

function isEditRoot(pathname) {
  return pathname === '/edit' || pathname === '/edit/';
}

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
}

function toEditForm(card) {
  return {
    year: String(card.year ?? ''),
    category: String(card.category ?? ''),
    title: String(card.title ?? ''),
    sortOrder: String(card.sortOrder ?? 0),
    previewKey: String(card.previewKey ?? '').replace(/^preview\//, ''),
  };
}

function stripExt(value) {
  const input = String(value || '');
  return input.replace(/\.[^.]+$/, '');
}

function parseSortableIndexFromKey(key) {
  const baseWithExt =
    String(key || '')
      .split('/')
      .pop() || '';
  const baseNoExt = stripExt(baseWithExt)
    .replace(/^delete_(.+)__(?:deleteAt|deleteCreated)_\d{8}$/, '$1')
    .replace(/^video_/, '');
  const match = baseNoExt.match(/(\d+)$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (
    !Array.isArray(items) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const copy = items.slice();
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDeleteDaysLeft(daysLeft) {
  const days = Number(daysLeft);
  if (!Number.isFinite(days)) {
    return 'Удаление по расписанию';
  }
  if (days <= 0) {
    return '0';
  }
  return `${days}`;
}

function formatDeleteDueDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return 'неизвестно';
  }
  return date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function SortablePreviewCard({
  item,
  index,
  disabled,
  group = 'gallery-edit-order',
  onDelete,
  onRestore,
  actionBusy,
}) {
  const pendingDeletion = Boolean(item?.isPendingDeletion);
  const { ref, isDragSource } = useSortable({
    id: item.key,
    index,
    group,
    disabled: disabled || pendingDeletion,
  });

  return (
    <div
      ref={ref}
      className={`${styles.reorderCard} ${isDragSource ? styles.reorderCardDragging : ''} ${disabled ? styles.reorderCardDisabled : ''} ${pendingDeletion ? styles.reorderCardPendingDelete : ''}`}
    >
      {pendingDeletion ? (
        <div className={styles.reorderDeleteBadge} aria-hidden="true">
          <Clock3 size={14} />
          <span>{formatDeleteDaysLeft(item.deleteDaysLeft)}</span>
        </div>
      ) : (
        <div className={styles.reorderHandle} aria-hidden="true">
          <GripVertical size={18} />
          <span>{index + 1}</span>
        </div>
      )}

      <button
        type="button"
        className={`${styles.reorderActionButton} ${pendingDeletion ? styles.reorderActionRestore : styles.reorderActionDelete}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pendingDeletion) {
            onRestore?.(item);
          } else {
            onDelete?.(item);
          }
        }}
        disabled={disabled || actionBusy}
        title={
          pendingDeletion
            ? 'Отменить удаление изображения'
            : 'Удалить изображение'
        }
      >
        {pendingDeletion ? <Undo2 size={18} /> : <Trash2 size={16} />}
      </button>

      <img
        src={item.url}
        loading="lazy"
        decoding="async"
        alt={item.name || item.key || `photo-${index + 1}`}
        className={`${styles.reorderImage} ${pendingDeletion ? styles.reorderImagePendingDelete : ''}`}
      />

      {item.isVideo && (
        <div className={styles.reorderVideoBadge} aria-hidden="true">
          <Play size={16} />
        </div>
      )}
    </div>
  );
}

function RootPendingDeleteCard({ item, onOpenFolder }) {
  return (
    <div className={styles.rootPendingCard}>
      <img
        src={item.url}
        loading="lazy"
        decoding="async"
        alt={item.name || item.key || 'delete-pending'}
        className={styles.rootPendingImage}
      />
      <div className={styles.rootPendingMeta}>
        <p>
          Папка: <strong>{item.folderPath}</strong>
        </p>
        <p>
          Удалится: <strong>{formatDeleteDueDate(item.deleteDueAt)}</strong>
        </p>
        <p>
          Осталось дней:{' '}
          <strong>{formatDeleteDaysLeft(item.deleteDaysLeft)}</strong>
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpenFolder(item.folderPath)}
        className={styles.rootPendingOpenButton}
      >
        Перейти в папку
      </button>
    </div>
  );
}

export default function GalleryEdit() {
  const csrfFetch = useCsrfFetch();
  const location = useLocation();
  const nav = useNavigate();

  const { authenticated, loading: sessionLoading } = useCheckSession();

  useEffect(() => {
    if (!sessionLoading && !authenticated) {
      nav('/login');
    }
  }, [sessionLoading, authenticated, nav]);

  const rootMode = isEditRoot(location.pathname);
  const targetPathFromUrl = location.pathname
    .replace(/^\/edit\//, '')
    .replace(/^\/+|\/+$/g, '');

  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [busyCardId, setBusyCardId] = useState(null);

  const [createForm, setCreateForm] = useState({
    year: String(new Date().getFullYear()),
    category: '',
    title: '',
    sortOrder: '',
    previewKey: '',
  });

  const [editForms, setEditForms] = useState({});

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isVideo, setIsVideo] = useState(false);
  const [galleryItems, setGalleryItems] = useState([]);
  const [galleryPendingDeleteItems, setGalleryPendingDeleteItems] = useState(
    [],
  );
  const [rootPendingDeleteItems, setRootPendingDeleteItems] = useState([]);
  const [rootPendingDeleteLoading, setRootPendingDeleteLoading] =
    useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [savingReorder, setSavingReorder] = useState(false);
  const [mediaActionBusyKey, setMediaActionBusyKey] = useState('');
  const [reorderBaseOrder, setReorderBaseOrder] = useState([]);
  const reorderLastToastStageRef = useRef('');

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    try {
      const res = await fetch(CARDS_API, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (res.status === 401) {
        nav('/login');
        return;
      }

      const { data } = await parseApiResponse(
        res,
        'Не удалось загрузить карточки',
      );
      const list = Array.isArray(data?.cards) ? data.cards : [];

      setCards(list);
      setEditForms(
        Object.fromEntries(list.map((card) => [card.id, toEditForm(card)])),
      );
    } catch (err) {
      notifyError(err, 'Не удалось загрузить карточки');
    } finally {
      setCardsLoading(false);
    }
  }, [nav]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const loadRootPendingDeleteItems = useCallback(async () => {
    if (!rootMode) {
      setRootPendingDeleteItems([]);
      return;
    }

    setRootPendingDeleteLoading(true);
    try {
      const fetched = [];
      let continuationToken = null;

      do {
        const params = new URLSearchParams({
          limit: '1000',
        });
        if (continuationToken) {
          params.set('continuationToken', continuationToken);
        }

        const res = await fetch(
          `${PENDING_DELETIONS_API}?${params.toString()}`,
          {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          },
        );

        if (res.status === 401) {
          nav('/login');
          return;
        }

        const { data } = await parseApiResponse(
          res,
          'Не удалось загрузить список фото под удалением',
        );

        const batch = Array.isArray(data?.items) ? data.items : [];
        fetched.push(...batch);
        continuationToken =
          data?.isTruncated && data?.nextContinuationToken
            ? String(data.nextContinuationToken)
            : null;
      } while (continuationToken);

      const deduped = Array.from(
        new Map(
          fetched
            .filter((item) => item && typeof item.key === 'string')
            .map((item) => [item.key, item]),
        ).values(),
      );

      deduped.sort((a, b) => {
        const dueA = Date.parse(String(a?.deleteDueAt || ''));
        const dueB = Date.parse(String(b?.deleteDueAt || ''));
        if (Number.isFinite(dueA) && Number.isFinite(dueB) && dueA !== dueB) {
          return dueA - dueB;
        }
        return String(a?.key || '').localeCompare(String(b?.key || ''));
      });

      setRootPendingDeleteItems(deduped);
    } catch (err) {
      notifyError(err, 'Не удалось загрузить список фото под удалением');
    } finally {
      setRootPendingDeleteLoading(false);
    }
  }, [nav, rootMode]);

  useEffect(() => {
    if (!rootMode) {
      setRootPendingDeleteItems([]);
      setRootPendingDeleteLoading(false);
      return;
    }
    loadRootPendingDeleteItems();
  }, [loadRootPendingDeleteItems, rootMode]);

  const handleRefreshRoot = useCallback(() => {
    void loadCards();
    void loadRootPendingDeleteItems();
  }, [loadCards, loadRootPendingDeleteItems]);

  const sortedCards = useMemo(() => {
    return cards
      .slice()
      .sort((a, b) => b.sortOrder - a.sortOrder || b.id - a.id);
  }, [cards]);

  const activeCard = useMemo(() => {
    if (!targetPathFromUrl) {
      return null;
    }
    return cards.find((card) => card.path === targetPathFromUrl) || null;
  }, [cards, targetPathFromUrl]);

  const setCreateField = (field, value) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  };

  const setEditField = (cardId, field, value) => {
    setEditForms((prev) => ({
      ...prev,
      [cardId]: {
        ...prev[cardId],
        [field]: value,
      },
    }));
  };

  const buildPath = (yearRaw, categoryRaw) => {
    const year = String(yearRaw || '')
      .trim()
      .replace(/[^0-9]/g, '');
    const category = normalizeCategory(categoryRaw);
    if (!/^\d{1,4}$/.test(year)) {
      throw validationError('Год должен быть числом, например 2026');
    }
    if (!category || !CATEGORY_RE.test(category)) {
      throw validationError(
        'Категория должна быть только на английском (только буквы)',
      );
    }
    return { year, category, path: `${year}/${category}` };
  };

  const handleCreateCard = async (event) => {
    event.preventDefault();

    try {
      const { year, path } = buildPath(createForm.year, createForm.category);
      const title = createForm.title.trim();
      if (!title) {
        throw validationError('Название карточки обязательно');
      }

      const sortRaw = createForm.sortOrder.trim();
      if (sortRaw && !/^-?\d+$/.test(sortRaw)) {
        throw validationError('Порядок должен быть целым числом');
      }

      const payload = {
        path,
        year: Number(year),
        title,
        previewKey: createForm.previewKey.trim() || null,
      };
      if (sortRaw) {
        payload.sortOrder = Number(sortRaw);
      }

      const res = await csrfFetch(CARDS_API, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const { data, message, status } = await parseApiResponse(
        res,
        'Не удалось создать карточку',
      );

      const createdPath = data?.card?.path || path;
      notify({
        status,
        message: message || `Карточка создана: ${createdPath}`,
      });
      setCreateForm((prev) => ({
        ...prev,
        category: '',
        title: '',
        sortOrder: '',
        previewKey: '',
      }));

      await loadCards();
      nav(`/edit/${createdPath}`);
    } catch (err) {
      notifyError(err, 'Не удалось создать карточку');
    }
  };

  const buildPatchFromForm = (cardId) => {
    const form = editForms[cardId];
    if (!form) {
      throw new Error('Форма карточки не найдена');
    }

    const { year, path } = buildPath(form.year, form.category);
    const title = form.title.trim();
    if (!title) {
      throw validationError('Название карточки обязательно');
    }

    const sortRaw = form.sortOrder.trim();
    if (!/^-?\d+$/.test(sortRaw)) {
      throw validationError('Порядок должен быть целым числом');
    }

    return {
      path,
      year: Number(year),
      title,
      sortOrder: Number(sortRaw),
      previewKey: form.previewKey.trim() || null,
    };
  };

  const handleSaveCard = async (card) => {
    try {
      setBusyCardId(card.id);
      const payload = buildPatchFromForm(card.id);
      const oldPath = card.path;

      const res = await csrfFetch(`${CARDS_API}/${card.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const { message, status } = await parseApiResponse(
        res,
        'Не удалось сохранить карточку',
      );

      notify({
        status,
        message: message || `Карточка обновлена: ${payload.path}`,
      });
      await loadCards();

      if (targetPathFromUrl === oldPath && oldPath !== payload.path) {
        nav(`/edit/${payload.path}`);
      }
    } catch (err) {
      notifyError(err, 'Не удалось сохранить карточку');
    } finally {
      setBusyCardId(null);
    }
  };

  const handleDeleteCard = async (card) => {
    const confirmed = window.confirm(`Удалить карточку ${card.path}?`);
    if (!confirmed) {
      return;
    }

    try {
      setBusyCardId(card.id);
      const res = await csrfFetch(`${CARDS_API}/${card.id}`, {
        method: 'DELETE',
      });
      const { message, status } = await parseApiResponse(
        res,
        'Не удалось удалить карточку',
      );
      notify({
        status,
        message: message || `Карточка удалена: ${card.path}`,
      });

      if (targetPathFromUrl === card.path) {
        nav('/edit');
      }
      await loadCards();
    } catch (err) {
      notifyError(err, 'Не удалось удалить карточку');
    } finally {
      setBusyCardId(null);
    }
  };

  const handleMoveCard = async (cardId, direction) => {
    const ordered = sortedCards;
    const idx = ordered.findIndex((card) => card.id === cardId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= ordered.length) {
      return;
    }

    const current = ordered[idx];
    const swapWith = ordered[targetIdx];

    try {
      setBusyCardId(cardId);
      const responses = await Promise.all([
        csrfFetch(`${CARDS_API}/${current.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sortOrder: swapWith.sortOrder }),
        }),
        csrfFetch(`${CARDS_API}/${swapWith.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sortOrder: current.sortOrder }),
        }),
      ]);
      const parsed = await Promise.all(
        responses.map((res) =>
          parseApiResponse(res, 'Не удалось изменить порядок'),
        ),
      );
      notify({
        status: parsed[0]?.status || 'success',
        message: `Порядок обновлён: ${current.path}`,
      });
      await loadCards();
    } catch (err) {
      notifyError(err, 'Не удалось изменить порядок');
    } finally {
      setBusyCardId(null);
    }
  };

  const handleCreateCardFromPath = async () => {
    if (!CARD_PATH_RE.test(targetPathFromUrl)) {
      notify({
        status: 'warning',
        message: 'Некорректный путь в URL, ожидается /edit/year/category',
      });
      return;
    }

    const [, category = ''] = targetPathFromUrl.split('/');
    try {
      const res = await csrfFetch(CARDS_API, {
        method: 'POST',
        body: JSON.stringify({
          path: targetPathFromUrl,
          title: category,
        }),
      });
      const { message, status } = await parseApiResponse(
        res,
        'Не удалось создать карточку',
      );
      notify({
        status,
        message: message || `Карточка создана: ${targetPathFromUrl}`,
      });
      await loadCards();
    } catch (err) {
      notifyError(err, 'Не удалось создать карточку');
    }
  };

  const canUpload = !rootMode && CARD_PATH_RE.test(targetPathFromUrl);
  const currentOrderKeys = useMemo(
    () => galleryItems.map((item) => item.key),
    [galleryItems],
  );
  const reorderDirty = useMemo(
    () => !arraysEqual(currentOrderKeys, reorderBaseOrder),
    [currentOrderKeys, reorderBaseOrder],
  );

  const loadGalleryItems = useCallback(async () => {
    if (!canUpload) {
      setGalleryItems([]);
      setGalleryPendingDeleteItems([]);
      setReorderBaseOrder([]);
      return;
    }

    setGalleryLoading(true);
    try {
      const prefix = `${targetPathFromUrl}/`;
      const fetched = [];
      let continuationToken = null;

      do {
        const params = new URLSearchParams({
          prefix,
          limit: '1000',
          includeDeleted: '1',
        });
        if (continuationToken) {
          params.set('continuationToken', continuationToken);
        }

        const res = await fetch(`${PREVIEWS_API}?${params.toString()}`, {
          credentials: 'include',
        });

        if (res.status === 401) {
          nav('/login');
          return;
        }
        if (!res.ok) {
          throw new Error('Не удалось загрузить фотографии для сортировки');
        }

        const data = await res.json();
        const batch = Array.isArray(data?.items) ? data.items : [];
        fetched.push(...batch);
        continuationToken =
          data?.isTruncated && data?.nextContinuationToken
            ? String(data.nextContinuationToken)
            : null;
      } while (continuationToken);

      const deduped = Array.from(
        new Map(
          fetched
            .filter((item) => item && typeof item.key === 'string')
            .map((item) => [item.key, item]),
        ).values(),
      );

      deduped.sort((a, b) => {
        const ai = parseSortableIndexFromKey(a?.key || '');
        const bi = parseSortableIndexFromKey(b?.key || '');
        if (ai !== bi) {
          return ai - bi;
        }
        return String(a?.key || '').localeCompare(String(b?.key || ''));
      });

      const activeItems = deduped.filter((item) => !item?.isPendingDeletion);
      const pendingItems = deduped.filter((item) => item?.isPendingDeletion);

      setGalleryItems(activeItems);
      setGalleryPendingDeleteItems(pendingItems);
      setReorderBaseOrder(activeItems.map((item) => item.key));
      reorderLastToastStageRef.current = '';
    } catch (err) {
      notifyError(err, 'Не удалось загрузить фото для сортировки');
    } finally {
      setGalleryLoading(false);
    }
  }, [canUpload, nav, targetPathFromUrl]);

  useEffect(() => {
    loadGalleryItems();
  }, [loadGalleryItems]);

  const handleDragEnd = useCallback(
    (event) => {
      if (savingReorder) {
        return;
      }
      const source = event?.operation?.source;
      const target = event?.operation?.target;
      const fromOp = Number.isInteger(source?.initialIndex)
        ? source.initialIndex
        : -1;
      const toOp = Number.isInteger(source?.index) ? source.index : -1;
      const sourceId = String(source?.id || '');
      const targetId = String(target?.id || '');

      setGalleryItems((prev) => {
        const fromIndex =
          fromOp >= 0 && fromOp < prev.length
            ? fromOp
            : prev.findIndex((item) => item.key === sourceId);
        const toIndex =
          toOp >= 0 && toOp < prev.length
            ? toOp
            : prev.findIndex((item) => item.key === targetId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
          return prev;
        }
        return moveArrayItem(prev, fromIndex, toIndex);
      });
    },
    [savingReorder],
  );

  const pollReorderStatus = useCallback(
    async (statusKey) => {
      for (let attempt = 0; attempt < REORDER_POLL_ATTEMPTS; attempt += 1) {
        const res = await fetch(
          `${REORDER_STATUS_API}?statusKey=${encodeURIComponent(statusKey)}`,
          {
            credentials: 'include',
          },
        );
        if (res.status === 401) {
          nav('/login');
          const err = new Error('Сессия истекла, выполните вход повторно');
          err.status = 'warning';
          throw err;
        }

        const { data } = await parseApiResponse(
          res,
          'Не удалось получить статус перестановки',
        );
        const job = data?.job || {};
        const status = String(job.status || '')
          .trim()
          .toLowerCase();
        const stage = String(job.stage || '').trim();
        const stageKey = stage || status || 'processing';

        if (stageKey && stageKey !== reorderLastToastStageRef.current) {
          reorderLastToastStageRef.current = stageKey;
          if (status !== 'done' && status !== 'success') {
            notify({
              status:
                status === 'error' || status === 'failed' ? 'error' : 'info',
              message:
                REORDER_STAGE_MESSAGES[stageKey] ||
                `Статус обработки: ${stageKey}`,
            });
          }
        }

        if (status === 'done' || status === 'success') {
          return job;
        }
        if (status === 'error' || status === 'failed') {
          const err = new Error(
            String(job.error || '').trim() ||
              'Ошибка обработки перестановки фотографий',
          );
          err.status = 'error';
          throw err;
        }

        await sleep(REORDER_POLL_DELAY_MS);
      }

      const timeoutErr = new Error(
        'Задача ещё выполняется. Обновите страницу через минуту для проверки.',
      );
      timeoutErr.status = 'info';
      throw timeoutErr;
    },
    [nav],
  );

  const handleMediaSoftDeleteAction = useCallback(
    async (item, action) => {
      if (!item?.key || savingReorder) {
        return;
      }

      const isRestore = action === 'restore';
      const confirmed = window.confirm(
        isRestore
          ? 'Отменить удаление этого изображения и вернуть исходное имя?'
          : 'Пометить это изображение на удаление? Файл скроется из галереи и удалится автоматически через 30 дней.',
      );
      if (!confirmed) {
        return;
      }

      const loadingToastId = notifyLoading(
        isRestore
          ? 'Ставим в очередь отмену удаления...'
          : 'Ставим в очередь удаление...',
      );
      setMediaActionBusyKey(item.key);

      try {
        const res = await csrfFetch(MEDIA_SOFT_DELETE_API, {
          method: 'POST',
          body: JSON.stringify({
            path: targetPathFromUrl,
            key: item.key,
            action,
          }),
        });
        const { status, message } = await parseApiResponse(
          res,
          isRestore
            ? 'Не удалось отменить удаление изображения'
            : 'Не удалось пометить изображение на удаление',
        );

        notify({
          status,
          message:
            message ||
            (isRestore
              ? 'Удаление отменено'
              : 'Изображение помечено на удаление'),
        });
        await loadGalleryItems();
      } catch (err) {
        notifyError(
          err,
          isRestore
            ? 'Не удалось отменить удаление изображения'
            : 'Не удалось пометить изображение на удаление',
        );
      } finally {
        setMediaActionBusyKey('');
        sileo.dismiss(loadingToastId);
      }
    },
    [csrfFetch, loadGalleryItems, savingReorder, targetPathFromUrl],
  );

  const handleSaveReorder = async () => {
    if (!canUpload || galleryItems.length === 0) {
      notify({
        status: 'warning',
        message: 'Нет фотографий для сортировки',
      });
      return;
    }
    if (!reorderDirty) {
      notify({
        status: 'info',
        message: 'Порядок не изменился',
      });
      return;
    }

    const loadingToastId = notifyLoading(
      'Сохраняем порядок и запускаем проверку hash...',
    );
    setSavingReorder(true);
    reorderLastToastStageRef.current = '';

    try {
      const res = await csrfFetch(REORDER_API, {
        method: 'POST',
        body: JSON.stringify({
          path: targetPathFromUrl,
          order: currentOrderKeys,
        }),
      });
      const { data, message, status } = await parseApiResponse(
        res,
        'Не удалось отправить порядок фотографий',
      );

      notify({
        status,
        message:
          message ||
          'Задача поставлена в очередь. Ожидаем завершение переименования.',
      });

      const statusKey = String(data?.statusKey || '').trim();
      if (statusKey) {
        await pollReorderStatus(statusKey);
        notify({
          status: 'success',
          message: 'Порядок фотографий сохранён и подтверждён по hash',
        });
      }

      await loadGalleryItems();
    } catch (err) {
      notifyError(err, 'Не удалось сохранить порядок фотографий');
    } finally {
      setSavingReorder(false);
      sileo.dismiss(loadingToastId);
    }
  };

  const handleUpload = async () => {
    if (!canUpload) {
      notify({
        status: 'warning',
        message: 'Сначала откройте /edit/year/category',
      });
      return;
    }
    if (!file) {
      notify({
        status: 'warning',
        message: 'Прикрепите файл',
      });
      return;
    }
    if (!file.type.startsWith('image/')) {
      notify({
        status: 'warning',
        message: 'Можно загружать только изображения (превью)',
      });
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('path', targetPathFromUrl);
    if (isVideo) {
      formData.append('video', 'true');
    }

    const loadingToastId = notifyLoading('Загружается...');

    try {
      const res = await csrfFetch('/api/gallery/upload', {
        method: 'POST',
        body: formData,
      });
      const { message, status } = await parseApiResponse(
        res,
        'Ошибка загрузки',
      );
      notify({
        status,
        message:
          message || 'Файл принят. Количество фото обновится после обработки.',
      });
      setFile(null);
      setIsVideo(false);
      void loadGalleryItems();
    } catch (err) {
      notifyError(err, 'Ошибка загрузки');
    } finally {
      sileo.dismiss(loadingToastId);
    }
  };

  return (
    <div
      className={`${styles.main} ${rootMode ? styles.mainRoot : styles.mainFolder}`}
    >
      {rootMode ? (
        <section className={styles.managerSection}>
          <div className={styles.sectionHead}>
            <h1>Создание и редактирование карточек</h1>
            <button type="button" onClick={handleRefreshRoot}>
              Обновить
            </button>
          </div>

          <form className={styles.createForm} onSubmit={handleCreateCard}>
            <h2>Создание новой папки</h2>
            <div className={styles.grid}>
              <label>
                Год
                <input
                  type="text"
                  inputMode="numeric"
                  onChange={(e) =>
                    setCreateField(
                      'year',
                      e.target.value.replace(/[^0-9]/g, ''),
                    )
                  }
                  placeholder="2026"
                />
              </label>
              <label>
                Категория (только англ. буквы)
                <input
                  type="text"
                  onChange={(e) =>
                    setCreateField(
                      'category',
                      normalizeCategory(e.target.value),
                    )
                  }
                  placeholder="leto"
                />
              </label>
              <label>
                Название
                <input
                  type="text"
                  onChange={(e) => setCreateField('title', e.target.value)}
                  placeholder="Лето"
                />
              </label>
              <label>
                Порядок
                <input
                  type="number"
                  onChange={(e) => setCreateField('sortOrder', e.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <button type="submit">Создать</button>
          </form>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Путь</th>
                  <th>Название</th>
                  <th>Порядок</th>
                  <th>Фото</th>
                  <th>Превью</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {cardsLoading && (
                  <tr>
                    <td colSpan={6}>Загрузка карточек...</td>
                  </tr>
                )}

                {!cardsLoading && sortedCards.length === 0 && (
                  <tr>
                    <td colSpan={6}>Карточек пока нет</td>
                  </tr>
                )}

                {!cardsLoading &&
                  sortedCards.map((card) => {
                    const form = editForms[card.id] || toEditForm(card);
                    const disabled = busyCardId === card.id;
                    const previewSource = card.thumbnailUrl || null;
                    return (
                      <tr key={card.id}>
                        <td>
                          <div className={styles.pathFields}>
                            <input
                              type="text"
                              value={form.year}
                              onChange={(e) =>
                                setEditField(
                                  card.id,
                                  'year',
                                  e.target.value.replace(/[^0-9]/g, ''),
                                )
                              }
                              placeholder="2026"
                            />
                            <span>/</span>
                            <input
                              type="text"
                              value={form.category}
                              onChange={(e) =>
                                setEditField(
                                  card.id,
                                  'category',
                                  normalizeCategory(e.target.value),
                                )
                              }
                              placeholder="leto"
                            />
                          </div>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={form.title}
                            onChange={(e) =>
                              setEditField(card.id, 'title', e.target.value)
                            }
                            placeholder="Лето, да!"
                          />
                        </td>
                        <td>
                          <div className={styles.sortField}>
                            <button
                              type="button"
                              onClick={() => handleMoveCard(card.id, -1)}
                              disabled={disabled}
                              title="Выше"
                            >
                              <CornerLeftUp />
                            </button>
                            <input
                              type="number"
                              value={form.sortOrder}
                              onChange={(e) =>
                                setEditField(
                                  card.id,
                                  'sortOrder',
                                  e.target.value,
                                )
                              }
                              placeholder="0"
                            />
                            <button
                              type="button"
                              onClick={() => handleMoveCard(card.id, 1)}
                              disabled={disabled}
                              title="Ниже"
                            >
                              <CornerRightDown />
                            </button>
                          </div>
                        </td>
                        <td>{card.imageCount}</td>
                        <td>
                          <input
                            type="text"
                            value={form.previewKey}
                            onChange={(e) =>
                              setEditField(
                                card.id,
                                'previewKey',
                                e.target.value,
                              )
                            }
                            placeholder="year/category/file.webp"
                          />
                          {previewSource && (
                            <img
                              src={previewSource}
                              alt=""
                              className={styles.inlinePreview}
                            />
                          )}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <button
                              type="button"
                              onClick={() => nav(`/${card.path}`)}
                            >
                              Откыть
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveCard(card)}
                              disabled={disabled}
                            >
                              Сохранить
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCard(card)}
                              disabled={disabled}
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className={styles.rootPendingSection}>
            <div className={styles.rootPendingHead}>
              <h2>Фото под удалением</h2>
              <button
                type="button"
                onClick={loadRootPendingDeleteItems}
                disabled={rootPendingDeleteLoading}
              >
                {rootPendingDeleteLoading ? 'Обновляем...' : 'Обновить список'}
              </button>
            </div>

            {rootPendingDeleteLoading ? (
              <div className={styles.reorderEmpty}>
                Загружаем фото под удалением...
              </div>
            ) : rootPendingDeleteItems.length === 0 ? (
              <div className={styles.reorderEmpty}>
                Фото под удалением не найдено
              </div>
            ) : (
              <div className={styles.rootPendingGrid}>
                {rootPendingDeleteItems.map((item) => (
                  <RootPendingDeleteCard
                    key={item.key}
                    item={item}
                    onOpenFolder={(folderPath) => nav(`/edit/${folderPath}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className={styles.uploadSection}>
          <h2>Загрузка фото в папку</h2>
          <p className={styles.helpText}>
            Папка: <strong>{targetPathFromUrl}</strong>
          </p>
          <p className={styles.helpText}>
            Название:{' '}
            <strong>{activeCard?.title || 'карточка не создана'}</strong>
          </p>
          {!activeCard && (
            <button type="button" onClick={handleCreateCardFromPath}>
              Создать карточку по URL
            </button>
          )}

          {previewUrl ? (
            <div className={styles.container}>
              <img src={previewUrl} alt="preview" className={styles.img} />
            </div>
          ) : (
            <div className={styles.item}>Прикрепите фотографию</div>
          )}

          <label className={styles.fileLabel}>
            <input
              type="checkbox"
              checked={isVideo}
              onChange={(e) => setIsVideo(e.target.checked)}
            />
            Это превью для видео
          </label>

          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files && e.target.files[0])}
          />

          <button type="button" onClick={handleUpload}>
            Загрузить
          </button>

          <div className={styles.reorderSection}>
            <div className={styles.reorderHead}>
              <h3>Порядок фотографий</h3>
              <div className={styles.reorderActions}>
                <button
                  type="button"
                  onClick={loadGalleryItems}
                  disabled={
                    galleryLoading || savingReorder || !!mediaActionBusyKey
                  }
                >
                  Обновить
                </button>
                <button
                  type="button"
                  onClick={handleSaveReorder}
                  disabled={
                    galleryLoading ||
                    savingReorder ||
                    !!mediaActionBusyKey ||
                    galleryItems.length === 0 ||
                    !reorderDirty
                  }
                >
                  {savingReorder ? 'Сохраняем...' : 'Сохранить порядок'}
                </button>
              </div>
            </div>

            {reorderDirty && !savingReorder && (
              <p className={styles.reorderHint}>
                Есть несохранённые изменения порядка
              </p>
            )}

            {galleryLoading ? (
              <div className={styles.reorderEmpty}>Загружаем фотографии...</div>
            ) : (
              <DragDropProvider onDragEnd={handleDragEnd}>
                {galleryItems.length === 0 ? (
                  <div className={styles.reorderEmpty}>
                    {galleryPendingDeleteItems.length > 0
                      ? 'Активных фото нет, но есть изображения под удалением'
                      : 'Пока нет фото для перетаскивания'}
                  </div>
                ) : (
                  <div className={styles.reorderGrid}>
                    {galleryItems.map((item, index) => (
                      <SortablePreviewCard
                        key={item.key}
                        item={item}
                        index={index}
                        group="gallery-edit-order"
                        disabled={savingReorder || !!mediaActionBusyKey}
                        actionBusy={mediaActionBusyKey === item.key}
                        onDelete={(targetItem) =>
                          handleMediaSoftDeleteAction(targetItem, 'delete')
                        }
                      />
                    ))}
                  </div>
                )}

                {galleryPendingDeleteItems.length > 0 && (
                  <div className={styles.pendingDeleteSection}>
                    <p className={styles.pendingDeleteTitle}>
                      Изображения под удалением (видно только в edit)
                    </p>
                    <div className={styles.reorderGrid}>
                      {galleryPendingDeleteItems.map((item, index) => (
                        <SortablePreviewCard
                          key={item.key}
                          item={item}
                          index={index}
                          group="gallery-edit-pending-delete"
                          disabled={savingReorder || !!mediaActionBusyKey}
                          actionBusy={mediaActionBusyKey === item.key}
                          onRestore={(targetItem) =>
                            handleMediaSoftDeleteAction(targetItem, 'restore')
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </DragDropProvider>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
