import { useState, useEffect } from 'react';

export function useCheckSession() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;

    fetch('/api/check-session', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((res) => {
        if (!mounted) return;
        if (res.status === 401) return { authenticated: false };
        if (!res.ok) throw new Error('Network error');
        return res.json();
      })
      .then((data) => {
        if (!mounted) return;
        if (data) setAuthenticated(!!data.authenticated);
        else setAuthenticated(false);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthenticated(false);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { authenticated, loading };
}
