import { useCallback } from 'react';

// import { useVibration } from '@/hooks/useVibration'
// const vibrate = useVibration()

/*
Возвращает функцию vibrate(type), где type:
    'click'  — лёгкая короткая вибрация
    'true'   — приятная очень слабая
    'warn'   — предупреждающая (потяжелее)
    'false'  — паттерн «вибрация–пауза–вибрация»
*/

const patterns = {
  click: 10,
  true: 20,
  warn: 200,
  false: [100, 50, 100],
};

export function useVibration() {
  const vibrate = useCallback((type) => {
    if (!('vibrate' in navigator)) return;
    const pattern = patterns[type] ?? patterns.click;
    navigator.vibrate(pattern);
    console.log(type, pattern);
  }, []);
  return vibrate;
}
