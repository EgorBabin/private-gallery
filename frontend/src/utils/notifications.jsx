import {
  AlertCircle,
  CheckCircle2,
  Info,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { sileo } from 'sileo';
import { normalizeToastStatus } from '@/utils/apiResponse';

const ICON_PROPS = {
  size: 20,
  strokeWidth: 2.2,
};

function iconByType(type) {
  if (type === 'success') {
    return <CheckCircle2 {...ICON_PROPS} />;
  }
  if (type === 'warning') {
    return <TriangleAlert {...ICON_PROPS} />;
  }
  if (type === 'error') {
    return <AlertCircle {...ICON_PROPS} />;
  }
  if (type === 'loading') {
    return <LoaderCircle {...ICON_PROPS} className="sileoSpin" />;
  }
  return <Info {...ICON_PROPS} />;
}

const TOAST_CALL = {
  success: sileo.success,
  error: sileo.error,
  warning: sileo.warning,
  info: sileo.info,
};

const SHORT_TITLE_BY_TYPE = {
  success: 'Готово',
  warning: 'Внимание',
  error: 'Ошибка',
  info: 'Статус',
  loading: 'Загрузка',
};

let loadingToastCounter = 0;

function nextLoadingToastId() {
  loadingToastCounter = (loadingToastCounter + 1) % 1_000_000;
  return `loading-${Date.now()}-${loadingToastCounter}`;
}

export const sileoDefaultOptions = {
  roundness: 16,
  styles: {
    title: 'sileoToastTitle',
    description: 'sileoToastDescription',
  },
};

export function notify({
  status = 'info',
  message = '',
  title,
  description,
  duration,
  icon,
} = {}) {
  const type = normalizeToastStatus(status, { ok: true });
  const resolvedTitle = String(title || SHORT_TITLE_BY_TYPE[type] || 'Статус')
    .trim()
    .slice(0, 28);
  const resolvedDescription = String(description ?? message ?? '').trim();
  const payload = {
    title: resolvedTitle,
    description: resolvedDescription || undefined,
    duration,
    icon: icon ?? iconByType(type),
  };

  const run = TOAST_CALL[type] || TOAST_CALL.info;
  return run(payload);
}

export function notifyError(error, fallbackMessage = 'Что-то пошло не так') {
  const message =
    (error && typeof error.message === 'string' && error.message.trim()) ||
    fallbackMessage;
  const status =
    (error && typeof error.status === 'string' && error.status) || 'error';

  return notify({ status, message });
}

export function notifyLoading(message = 'Загружается...') {
  return sileo.show({
    id: nextLoadingToastId(),
    type: 'loading',
    title: SHORT_TITLE_BY_TYPE.loading,
    description: message,
    duration: null,
    icon: iconByType('loading'),
  });
}
