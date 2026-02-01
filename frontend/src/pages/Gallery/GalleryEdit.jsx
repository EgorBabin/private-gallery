import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import styles from './GalleryEdit.module.css';

export default function UploadForm() {
  const csrfFetch = useCsrfFetch();
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const location = useLocation();

  const handleUpload = async () => {
    if (!file) return;

    const path = location.pathname.replace(/^\/edit\//, '');

    const formData = new FormData();
    formData.append('image', file);
    formData.append('path', path);

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
    } catch (e) {
      console.error(e);
      setStatus('Ошибка соединения');
    }
  };

  return (
    <div className={styles.main}>
      {file ? (
        <div className={styles.container}>
          <img
            src={URL.createObjectURL(file)}
            alt="preview"
            className={styles.img}
          />
        </div>
      ) : (
        <div className={styles.item}>Прикрепите фотографию</div>
      )}

      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <button onClick={handleUpload}>Загрузить</button>
      <p>{status}</p>
    </div>
  );
}
