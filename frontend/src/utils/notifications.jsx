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
  size: 16,
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

export const sileoDefaultOptions = {
  fill: 'var(--color-background-elevated)',
  duration: 3400,
  roundness: 12,
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
  const resolvedTitle = String(title || message || 'Готово').trim();
  const payload = {
    title: resolvedTitle,
    description,
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
    type: 'loading',
    title: message,
    duration: null,
    icon: iconByType('loading'),
  });
}
