import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';

export default function UploadForm() {
  const csrfFetch = useCsrfFetch();
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const location = useLocation();

  const handleUpload = async () => {
    if (!file) return;

    const path = location.pathname.replace(/^\/edit\//, ''); // "2020/event"

    const formData = new FormData();
    formData.append('image', file);
    formData.append('path', path);

    setStatus('Загружается...');

    try {
      const res = await csrfFetch('/api/gallery/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok) setStatus(`✅ Загружено: ${data.newFile}`);
      else setStatus(`❌ Ошибка: ${data.error}`);
    } catch (err) {
      console.error(err);
      setStatus('Ошибка соединения');
    }
  };

  return (
    <div>
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
