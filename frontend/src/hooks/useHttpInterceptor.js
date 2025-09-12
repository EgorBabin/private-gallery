import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function useHttpInterceptor({
  redirectTo = '/login',
  replace = true,
} = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!globalThis.__httpInterceptorFetchInstalled) {
      const _fetch = window.fetch.bind(window);

      async function tryParseJson(response) {
        try {
          return await response.json();
        } catch (parseErr) {
          console.debug('tryParseJson failed:', parseErr);
          return null;
        }
      }

      window.fetch = async (...args) => {
        try {
          if (!args[1]) args[1] = { credentials: 'include' };
          else if (!args[1].credentials)
            args[1].credentials = args[1].credentials || 'include';

          const res = await _fetch(...args);

          if (res.status === 401) {
            const data = await tryParseJson(res.clone());
            const dest =
              data?.redirect || res.headers.get('x-redirect') || redirectTo;
            try {
              navigate(dest, { replace });
            } catch (navErr) {
              console.debug(
                'navigate failed, falling back to location.href:',
                navErr,
              );
              window.location.href = dest;
            }
          }

          return res;
        } catch (fetchErr) {
          // если fetch упал — логируем и пробрасываем
          console.debug('fetch wrapper error:', fetchErr);
          throw fetchErr;
        }
      };

      globalThis.__httpInterceptorFetchInstalled = true;
    }

    let axiosEjectId = null;
    try {
      const ax = globalThis.axios || window.axios;
      if (ax && ax.interceptors && ax.interceptors.response) {
        ax.defaults.withCredentials = true;
        axiosEjectId = ax.interceptors.response.use(
          (r) => r,
          (err) => {
            if (err.response?.status === 401) {
              const dest =
                err.response?.data?.redirect ||
                err.response?.headers?.['x-redirect'] ||
                redirectTo;
              try {
                navigate(dest, { replace });
              } catch (navErr) {
                console.debug(
                  'axios navigate failed, fallback to location.href:',
                  navErr,
                );
                window.location.href = dest;
              }
            }
            return Promise.reject(err);
          },
        );
      }
    } catch (initErr) {
      console.debug('axios interceptor init failed:', initErr);
    }

    return () => {
      try {
        const ax = globalThis.axios || window.axios;
        if (ax && axiosEjectId != null)
          ax.interceptors.response.eject(axiosEjectId);
      } catch (cleanupErr) {
        console.debug('axios interceptor cleanup failed:', cleanupErr);
      }
    };
  }, [navigate, redirectTo, replace]);
}
