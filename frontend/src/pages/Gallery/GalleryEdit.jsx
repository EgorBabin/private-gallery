import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CornerLeftUp, CornerRightDown } from 'lucide-react';
import { sileo } from 'sileo';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { useCheckSession } from '@/hooks/useCheckSession';
import { parseApiResponse } from '@/utils/apiResponse';
import { notify, notifyError, notifyLoading } from '@/utils/notifications';
import styles from './GalleryEdit.module.css';

const CARDS_API = '/api/gallery/cards-admin';
const CATEGORY_RE = /^[A-Za-z]+$/;
const CARD_PATH_RE = /^\d{1,4}\/[A-Za-z]+$/;

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
            <button type="button" onClick={loadCards}>
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
        </section>
      )}
    </div>
  );
}
