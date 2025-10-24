import { useState, useEffect, useCallback } from 'react';

export function useCsrfFetch() {
  const [token, setToken] = useState(null);

  useEffect(() => {
    fetch('/api/csrf-token', { credentials: 'include' })
      .then((r) => r.json())
      .then(({ csrfToken }) => setToken(csrfToken))
      .catch(console.error);
  }, []);

  return useCallback(
    async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      const headers = { ...(options.headers || {}) };

      const isFormData = options.body instanceof FormData;

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (!token) throw new Error('CSRF token not ready');
        headers['X-CSRF-Token'] = token;

        if (!isFormData) {
          headers['Content-Type'] =
            headers['Content-Type'] || 'application/json';
        }
      }

      return fetch(url, {
        credentials: 'include',
        ...options,
        headers,
      });
    },
    [token],
  );
}
