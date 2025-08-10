import { useState, useEffect } from 'react';

export function useCheckSession() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;

    fetch('/api/check-session', {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        setAuthenticated(!!data.authenticated);
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
