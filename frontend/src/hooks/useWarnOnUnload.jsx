import { useEffect } from 'react';

/*
@param enabled — если true, при попытке закрыть вкладку/окно
браузер покажет предупреждение о несохраненных изменениях.
*/

export function useWarnOnUnload(enabled) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [enabled]);
}
