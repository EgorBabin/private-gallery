import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

// Форматы исходников. Готовая сборка sharp (libvips) не открывает HEIC
// (кодек HEVC закрыт патентами) и RAW камер, поэтому такие файлы сначала
// переводятся системными утилитами из образа (см. backend/Dockerfile):
//   HEIC/HEIF -> heif-dec (libheif + libde265)
//   RAW       -> dcraw_emu (LibRaw)
// Оригинал в S3 при этом хранится как есть.

export const WEB_IMAGE_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.avif',
    '.gif',
    '.tif',
    '.tiff',
];
// .hif — HEIF 10 бит с камер Canon/Sony/Fujifilm
export const HEIF_EXTENSIONS = ['.heic', '.heif', '.hif'];
export const RAW_EXTENSIONS = [
    '.arw', // Sony
    '.srf',
    '.sr2',
    '.cr2', // Canon
    '.cr3',
    '.crw',
    '.nef', // Nikon
    '.nrw',
    '.dng', // Adobe DNG, телефоны (Apple ProRAW, Android)
    '.raf', // Fujifilm
    '.orf', // Olympus / OM System
    '.rw2', // Panasonic
    '.pef', // Pentax
    '.srw', // Samsung
    '.x3f', // Sigma
    '.3fr', // Hasselblad
    '.iiq', // Phase One
    '.mrw', // Minolta
    '.erf', // Epson
    '.kdc', // Kodak
    '.dcr',
    '.mos', // Leaf
    '.rwl', // Leica
    '.raw',
];
export const ORIGINAL_IMAGE_EXTENSIONS = [
    ...WEB_IMAGE_EXTENSIONS,
    ...HEIF_EXTENSIONS,
    ...RAW_EXTENSIONS,
];

const extensionsPattern = (list) => list.map((ext) => ext.slice(1)).join('|');

/** Любой файл медиа в папке: оригиналы всех форматов, preview и видео. */
export const MEDIA_FILE_RE = new RegExp(
    `\\.(${extensionsPattern(ORIGINAL_IMAGE_EXTENSIONS)}|mp4)$`,
    'i',
);
/** Оригинал фото, из которого можно заново построить preview/screen-*. */
export const ORIGINAL_IMAGE_RE = new RegExp(
    `\\.(${extensionsPattern(ORIGINAL_IMAGE_EXTENSIONS)})$`,
    'i',
);

const DECODE_TIMEOUT_MS = 3 * 60 * 1000;
const execFileAsync = promisify(execFile);

export function sourceKind(fileName) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    if (HEIF_EXTENSIONS.includes(ext)) {
        return 'heif';
    }
    if (RAW_EXTENSIONS.includes(ext)) {
        return 'raw';
    }
    return 'image';
}

async function runConverter(tool, args) {
    try {
        await execFileAsync(tool, args, {
            timeout: DECODE_TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024,
        });
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(
                `${tool} не установлен: пересоберите образ backend`,
            );
        }
        const details = String(err.stderr || err.message || '').trim();
        throw new Error(`${tool} не смог прочитать файл: ${details}`);
    }
}

// Утилиты сами выбирают имя результата (dcraw_emu дописывает .tiff к имени
// входного файла), поэтому берём любой новый файл во временной папке.
async function readConvertedFile(dir, inputPath) {
    const names = (await fs.readdir(dir))
        .map((name) => path.join(dir, name))
        .filter((file) => file !== inputPath)
        .sort();
    if (names.length === 0) {
        throw new Error('конвертер не создал файл');
    }
    return fs.readFile(names[0]);
}

/**
 * Готовит исходник для sharp.
 * @returns {Promise<{input: Buffer, oriented: boolean}>} oriented — поворот
 *   уже применён конвертером, EXIF-поворот в sharp делать не нужно.
 */
export async function decodeSourceImage(buffer, fileName) {
    const kind = sourceKind(fileName);
    if (kind === 'image') {
        return { input: buffer, oriented: false };
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-decode-'));
    const ext = path.extname(String(fileName)).toLowerCase();
    const inputPath = path.join(dir, `source${ext}`);
    try {
        await fs.writeFile(inputPath, buffer);

        if (kind === 'heif') {
            // основное изображение HEIC в PNG, повороты из файла применяются
            await runConverter('heif-dec', [
                inputPath,
                path.join(dir, 'decoded.png'),
            ]);
            return {
                input: await readConvertedFile(dir, inputPath),
                oriented: true,
            };
        }

        // RAW: -w баланс белого камеры, -h половинный размер (для 24 Мп это
        // ~3000 px по ширине, больше самого крупного варианта 2560, а
        // обработка в разы быстрее), -T TIFF; поворот камеры применяется,
        // результат: source.<ext>.tiff
        await runConverter('dcraw_emu', ['-w', '-h', '-T', inputPath]);
        return {
            input: await readConvertedFile(dir, inputPath),
            oriented: true,
        };
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}
