// Форматы, которые принимает загрузка (список совпадает с
// backend/utils/sourceDecoder.js). Для RAW браузер обычно не знает MIME-тип,
// поэтому файл проверяется по расширению.

const WEB_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.tif',
  '.tiff',
];
const HEIF_EXTENSIONS = ['.heic', '.heif', '.hif'];
const RAW_EXTENSIONS = [
  '.arw',
  '.srf',
  '.sr2',
  '.cr2',
  '.cr3',
  '.crw',
  '.nef',
  '.nrw',
  '.dng',
  '.raf',
  '.orf',
  '.rw2',
  '.pef',
  '.srw',
  '.x3f',
  '.3fr',
  '.iiq',
  '.mrw',
  '.erf',
  '.kdc',
  '.dcr',
  '.mos',
  '.rwl',
  '.raw',
];
const UPLOAD_EXTENSIONS = [
  ...WEB_IMAGE_EXTENSIONS,
  ...HEIF_EXTENSIONS,
  ...RAW_EXTENSIONS,
];

// Браузеры умеют показывать не все форматы: TIFF, HEIC (кроме Safari) и RAW
// в превью перед загрузкой показываются плашкой с расширением.
const BROWSER_PREVIEW_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
];

/** Значение атрибута accept: image/* плюс явные расширения RAW и HEIC. */
export const UPLOAD_ACCEPT = [
  'image/*',
  ...HEIF_EXTENSIONS,
  ...RAW_EXTENSIONS,
].join(',');

export function fileExtension(file) {
  const name = String(file?.name || '');
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

// файл без расширения принимается по MIME-типу, как и на сервере
const UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/x-adobe-dng',
];

export function isUploadableImage(file) {
  if (UPLOAD_EXTENSIONS.includes(fileExtension(file))) {
    return true;
  }
  return UPLOAD_MIME_TYPES.includes(String(file?.type || '').toLowerCase());
}

export function canPreviewInBrowser(file) {
  return BROWSER_PREVIEW_EXTENSIONS.includes(fileExtension(file));
}
