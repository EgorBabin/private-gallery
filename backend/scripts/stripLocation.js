// Удаляет координаты съёмки (GPS) из уже загруженных оригиналов в S3.
// Файлы не ломаются: координаты затираются на месте (см. utils/stripLocation.js),
// а перед перезаписью каждый файл проверяется.
//
// Проверка без изменений (по умолчанию):
//   docker compose run --rm photo-worker node scripts/stripLocation.js
// Очистить файлы в S3:
//   docker compose run --rm photo-worker node scripts/stripLocation.js --apply
// Только одна папка: --prefix=2024/trip
import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import {
    listAllObjects,
    getObjectBufferFromS3,
    uploadToS3,
} from '../utils/s3Client.js';
import { stripLocation, hasLocation } from '../utils/stripLocation.js';
import { ORIGINAL_IMAGE_RE } from '../utils/sourceDecoder.js';

const ORIGINAL_ROOT = 'original_photo/';
const APPLY = process.argv.includes('--apply');
const prefixArg = process.argv.find((arg) => arg.startsWith('--prefix='));
const folder = prefixArg
    ? prefixArg.slice('--prefix='.length).replace(/^\/+|\/+$/g, '')
    : '';

async function pixelHash(buffer) {
    const { data, info } = await sharp(buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
    return `${info.width}x${info.height}:${crypto.createHash('sha256').update(data).digest('hex')}`;
}

/** Убеждается, что в файле изменились только координаты. */
async function verifyCleaned(original, result) {
    if (hasLocation(result.buffer)) {
        throw new Error('координаты остались после очистки');
    }

    if (result.xmpRewritten) {
        // JPEG пересобран из-за XMP: изображение должно совпасть пиксель в пиксель
        if ((await pixelHash(original)) !== (await pixelHash(result.buffer))) {
            throw new Error('изображение изменилось');
        }
        return;
    }

    // правка на месте: тот же размер, отличия только внутри блоков GPS
    if (original.length !== result.buffer.length) {
        throw new Error('изменился размер файла');
    }
    const inWiped = (index) =>
        result.wipedRanges.some(
            ([start, end]) => index >= start && index < end,
        );
    for (let i = 0; i < original.length; i += 1) {
        if (original[i] !== result.buffer[i] && !inWiped(i)) {
            throw new Error(`изменён байт вне блока GPS (${i})`);
        }
    }
}

async function main() {
    const prefix = folder ? `${ORIGINAL_ROOT}${folder}/` : ORIGINAL_ROOT;
    const objects = (await listAllObjects(prefix)).filter((obj) =>
        ORIGINAL_IMAGE_RE.test(obj?.Key || ''),
    );
    console.log(
        `${APPLY ? 'APPLY' : 'DRY RUN'}: ${objects.length} originals under ${prefix}`,
    );

    const byExt = new Map();
    let withLocation = 0;
    let cleaned = 0;
    let failed = 0;

    for (const [i, obj] of objects.entries()) {
        try {
            const original = await getObjectBufferFromS3(obj.Key);
            const result = stripLocation(original);
            if (result.changed) {
                withLocation += 1;
                const ext = path.extname(obj.Key).toLowerCase();
                byExt.set(ext, (byExt.get(ext) || 0) + 1);
                await verifyCleaned(original, result);
                if (APPLY) {
                    await uploadToS3(result.buffer, obj.Key);
                    cleaned += 1;
                }
            }
        } catch (err) {
            failed += 1;
            console.error(`Пропущен ${obj.Key}: ${err.message}`);
        }

        if ((i + 1) % 50 === 0) {
            console.log(`  проверено ${i + 1}/${objects.length}`);
        }
    }

    const formats = [...byExt.entries()]
        .map(([ext, count]) => `${ext} ${count}`)
        .join(', ');
    console.log(
        `Готово. С координатами: ${withLocation}${formats ? ` (${formats})` : ''}, очищено: ${cleaned}, пропущено из-за ошибок: ${failed}`,
    );
    if (!APPLY && withLocation > 0) {
        console.log('Запустите с --apply, чтобы удалить координаты.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
