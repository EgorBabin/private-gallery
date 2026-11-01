import { useEffect } from 'react';
import { useWarnOnUnload } from '@/hooks/useWarnOnUnload';

// Защита от потери несохранённых изменений:
// - закрытие/обновление вкладки — стандартное предупреждение браузера;
// - переход по ссылкам внутри сайта (шапка, вкладки админки) — confirmLeave().

let unsavedCount = 0;

export function confirmLeave() {
  if (unsavedCount === 0) {
    return true;
  }
  return window.confirm(
    'Есть несохранённые изменения. Уйти со страницы без сохранения?',
  );
}

export function useUnsavedGuard(dirty) {
  useWarnOnUnload(dirty);

  useEffect(() => {
    if (!dirty) return undefined;
    unsavedCount += 1;
    return () => {
      unsavedCount -= 1;
    };
  }, [dirty]);
}
