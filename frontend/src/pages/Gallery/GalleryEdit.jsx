import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import styles from './GalleryEdit.module.css';

export default function UploadForm() {
  const csrfFetch = useCsrfFetch();
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [status, setStatus] = useState('');

  const [year, setYear] = useState('');
  const [title, setTitle] = useState('');
  const [isVideo, setIsVideo] = useState(false);

  const location = useLocation();

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const isEditRoot = (pathname) => {
    return pathname === '/edit' || pathname === '/edit/';
  };

  const slugify = (str) => {
    return encodeURIComponent(
      String(str)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  };

  const handleUpload = async () => {
    if (!file) {
      setStatus('Прикрепите файл');
      return;
    }

    let path = '';

    if (isEditRoot(location.pathname)) {
      if (!year.trim() || !title.trim()) {
        setStatus('Введите год и название');
        return;
      }

      if (!/^\d{1,4}$/.test(year.trim())) {
        setStatus('Год должен содержать только цифры (например 2026)');
        return;
      }

      path = `${year.trim()}/${slugify(title)}`;
    } else {
      path = location.pathname.replace(/^\/edit\//, '').replace(/\/+$/, '');
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('path', path);

    if (isVideo) {
      formData.append('video', 'true');
    }

    setStatus('Загружается...');

    try {
      const res = await csrfFetch('/api/gallery/upload', {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await res.json()
        : null;

      if (!res.ok) {
        setStatus(data?.error || `Ошибка ${res.status}`);
        return;
      }

      setStatus('✅ Файл принят и обрабатывается');
      setFile(null);
      setYear('');
      setTitle('');
      setIsVideo(false);
    } catch (e) {
      console.error(e);
      setStatus('Ошибка соединения');
    }
  };

  return (
    <div className={styles.main}>
      {previewUrl ? (
        <div className={styles.container}>
          <img src={previewUrl} alt="preview" className={styles.img} />
        </div>
      ) : (
        <div className={styles.item}>Прикрепите фотографию</div>
      )}

      {isEditRoot(location.pathname) && (
        <div className={styles.metaFields}>
          <p>Создание новой папки:</p>

          <p>
            <label>
              Год
              <input
                type="text"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="2026"
              />
            </label>
          </p>

          <p>
            <label>
              Название папки
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="С мал. буквы, на англ."
              />
            </label>
          </p>
        </div>
      )}

      <p>
        <label>
          <input
            type="checkbox"
            checked={isVideo}
            onChange={(e) => setIsVideo(e.target.checked)}
          />{' '}
          Это превью для видео
        </label>
        <p>
          <i>забронировать место для видео</i>
        </p>
      </p>

      <input
        type="file"
        accept={isVideo ? 'video/*' : 'image/*'}
        onChange={(e) => setFile(e.target.files && e.target.files[0])}
      />

      <button onClick={handleUpload}>Загрузить</button>
      <p>{status}</p>
    </div>
  );
}
