import zlib from 'zlib';

// Удаление координат съёмки (GPS) из фото без повреждения файла.
//
// Главный принцип — правка на месте: блок GPS внутри EXIF/TIFF затирается
// нулями, размер файла и все смещения внутри него не меняются. Поэтому
// изображение, поворот, дата, камера, XMP и прочие метаданные остаются
// нетронутыми, а контейнеры со ссылками по смещениям (HEIC, RAW) не ломаются.
//
// Где ищутся координаты:
// - JPEG: EXIF (APP1), а также GPS-поля в XMP (сегмент переписывается);
// - TIFF и RAW на его основе (DNG, ARW, NEF, CR2, ORF, RW2, PEF...): GPS IFD;
// - любой встроенный блок "Exif\0\0" + TIFF: HEIC/HEIF, превью в RAW
//   (RAF и др.), дополнительные кадры JPEG (MPF), WebP;
// - Canon CR3: бокс CMT4 (это и есть GPS IFD);
// - PNG: чанк eXIf (с пересчётом CRC).
//
// Перед любой правкой структура строго проверяется (теги GPS 0..31,
// допустимые типы и размеры), иначе файл не трогается.

const GPS_IFD_TAG = 0x8825;
const MAX_GPS_TAG = 0x1f;
const TYPE_SIZES = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    6: 1,
    7: 1,
    8: 2,
    9: 4,
    10: 8,
    11: 4,
    12: 8,
    13: 4,
};
const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

function tiffReader(buf, tiffStart, limit) {
    if (tiffStart < 0 || tiffStart + 8 > limit) {
        return null;
    }
    const order = buf.toString('latin1', tiffStart, tiffStart + 2);
    if (order !== 'II' && order !== 'MM') {
        return null;
    }
    const le = order === 'II';
    const u16 = (pos) => (le ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos));
    const u32 = (pos) => (le ? buf.readUInt32LE(pos) : buf.readUInt32BE(pos));
    // 42 — TIFF; у ORF ("RO"/"RS") и RW2 (0x55) свои подписи
    const magic = u16(tiffStart + 2);
    if (![42, 0x4f52, 0x5352, 0x55].includes(magic)) {
        return null;
    }
    const inside = (offset, size) =>
        offset >= 0 && tiffStart + offset + size <= limit;
    return { u16, u32, inside };
}

/**
 * Проверяет GPS IFD по смещению и возвращает диапазоны для затирания,
 * либо null, если структура не похожа на GPS IFD (тогда ничего не трогаем).
 */
function planGpsIfdWipe(buf, tiffStart, limit, reader, gpsOffset) {
    const { u16, u32, inside } = reader;
    if (!inside(gpsOffset, 2)) {
        return null;
    }
    const count = u16(tiffStart + gpsOffset);
    if (count === 0) {
        return []; // уже очищен
    }
    if (count > 64 || !inside(gpsOffset, 2 + count * 12)) {
        return null;
    }

    const ranges = [];
    for (let i = 0; i < count; i += 1) {
        const entry = tiffStart + gpsOffset + 2 + i * 12;
        const tag = u16(entry);
        const type = u16(entry + 2);
        const valueCount = u32(entry + 4);
        const typeSize = TYPE_SIZES[type];
        if (tag > MAX_GPS_TAG || !typeSize || valueCount > 4096) {
            return null;
        }
        const size = typeSize * valueCount;
        if (size > 4) {
            const valueOffset = u32(entry + 8);
            if (!inside(valueOffset, size)) {
                return null;
            }
            ranges.push([
                tiffStart + valueOffset,
                tiffStart + valueOffset + size,
            ]);
        }
    }
    // сами записи и счётчик: пустой GPS IFD остаётся корректным
    ranges.push([
        tiffStart + gpsOffset,
        tiffStart + gpsOffset + 2 + count * 12,
    ]);
    return ranges;
}

/** GPS IFD, на который указывает IFD0 TIFF-структуры. */
function planTiffGpsWipe(buf, tiffStart, limit) {
    const reader = tiffReader(buf, tiffStart, limit);
    if (!reader) {
        return null;
    }
    const { u16, u32, inside } = reader;
    const ifd0 = u32(tiffStart + 4);
    if (!inside(ifd0, 2)) {
        return null;
    }
    const count = u16(tiffStart + ifd0);
    if (count === 0 || count > 1000 || !inside(ifd0, 2 + count * 12)) {
        return null;
    }
    for (let i = 0; i < count; i += 1) {
        const entry = tiffStart + ifd0 + 2 + i * 12;
        if (u16(entry) !== GPS_IFD_TAG) {
            continue;
        }
        const type = u16(entry + 2);
        if ((type !== 4 && type !== 13) || u32(entry + 4) !== 1) {
            return null;
        }
        return planGpsIfdWipe(buf, tiffStart, limit, reader, u32(entry + 8));
    }
    return []; // GPS нет
}

/** CR3: бокс CMT4 содержит TIFF, у которого IFD0 и есть GPS IFD. */
function planCr3Wipes(buf) {
    const plans = [];
    let from = 0;
    for (;;) {
        const at = buf.indexOf('CMT4', from, 'latin1');
        if (at < 4) {
            break;
        }
        from = at + 4;
        const boxStart = at - 4;
        const boxSize = buf.readUInt32BE(boxStart);
        const boxEnd = boxStart + boxSize;
        if (boxSize < 16 || boxEnd > buf.length) {
            continue;
        }
        const tiffStart = at + 4;
        const reader = tiffReader(buf, tiffStart, boxEnd);
        if (!reader) {
            continue;
        }
        const plan = planGpsIfdWipe(
            buf,
            tiffStart,
            boxEnd,
            reader,
            reader.u32(tiffStart + 4),
        );
        if (plan) {
            plans.push(...plan);
        }
    }
    return plans;
}

/** Все вхождения "Exif\0\0" + TIFF (HEIC, превью в RAW, MPF, WebP). */
function planEmbeddedExifWipes(buf) {
    const plans = [];
    let from = 0;
    for (;;) {
        const at = buf.indexOf(EXIF_HEADER, from);
        if (at < 0) {
            break;
        }
        from = at + EXIF_HEADER.length;
        const plan = planTiffGpsWipe(buf, at + EXIF_HEADER.length, buf.length);
        if (plan) {
            plans.push(...plan);
        }
    }
    return plans;
}

// GPS-поля в XMP: атрибуты exif:GPS...="..." и элементы <exif:GPS...>...</...>
const XMP_GPS_ATTR_RE = /\s(?:exif|exifEX):GPS[A-Za-z]*="[^"]*"/g;
const XMP_GPS_ELEMENT_RE =
    /<((?:exif|exifEX):GPS[A-Za-z]*)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;

function stripXmpGps(xml) {
    return xml.replace(XMP_GPS_ATTR_RE, '').replace(XMP_GPS_ELEMENT_RE, '');
}

/** JPEG: переписывает только сегменты XMP с координатами. */
function stripJpegXmp(buf) {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) {
        return { buffer: buf, rewritten: false };
    }
    const parts = [];
    let cursor = 0;
    let rewritten = false;
    let pos = 2;
    while (pos + 4 <= buf.length) {
        if (buf[pos] !== 0xff) {
            break;
        }
        const marker = buf[pos + 1];
        if (marker === 0xff) {
            pos += 1;
            continue;
        }
        if (marker === 0xda || marker === 0xd9) {
            break;
        }
        if (marker >= 0xd0 && marker <= 0xd7) {
            pos += 2;
            continue;
        }
        const length = buf.readUInt16BE(pos + 2);
        const end = pos + 2 + length;
        if (length < 2 || end > buf.length) {
            break;
        }
        const dataStart = pos + 4;
        if (
            marker === 0xe1 &&
            buf
                .subarray(dataStart, dataStart + XMP_HEADER.length)
                .equals(XMP_HEADER)
        ) {
            const xmlStart = dataStart + XMP_HEADER.length;
            const xml = buf.toString('utf8', xmlStart, end);
            const cleaned = stripXmpGps(xml);
            if (cleaned !== xml) {
                const body = Buffer.concat([
                    XMP_HEADER,
                    Buffer.from(cleaned, 'utf8'),
                ]);
                const header = Buffer.from([0xff, 0xe1, 0, 0]);
                header.writeUInt16BE(body.length + 2, 2);
                parts.push(buf.subarray(cursor, pos), header, body);
                cursor = end;
                rewritten = true;
            }
        }
        pos = end;
    }
    if (!rewritten) {
        return { buffer: buf, rewritten: false };
    }
    parts.push(buf.subarray(cursor));
    return { buffer: Buffer.concat(parts), rewritten: true };
}

/** PNG: чанк eXIf (TIFF без префикса), после правки пересчитывается CRC. */
function planPngWipes(buf) {
    const signature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (!buf.subarray(0, 8).equals(signature)) {
        return { plans: [], crcFixes: [] };
    }
    const plans = [];
    const crcFixes = [];
    let pos = 8;
    while (pos + 12 <= buf.length) {
        const length = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const dataStart = pos + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buf.length) {
            break;
        }
        if (type === 'eXIf') {
            const plan = planTiffGpsWipe(buf, dataStart, dataEnd);
            if (plan && plan.length > 0) {
                plans.push(...plan);
                crcFixes.push({ typeStart: pos + 4, dataEnd });
            }
        }
        if (type === 'IEND') {
            break;
        }
        pos = dataEnd + 4;
    }
    return { plans, crcFixes };
}

function mergeRanges(ranges) {
    const sorted = ranges
        .filter(([start, end]) => end > start)
        .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) {
            last[1] = Math.max(last[1], range[1]);
        } else {
            merged.push([...range]);
        }
    }
    return merged;
}

/**
 * @param {Buffer} input
 * @returns {{buffer: Buffer, changed: boolean, wipedRanges: Array<[number, number]>, xmpRewritten: boolean}}
 *   wipedRanges — изменённые на месте участки, включая пересчитанный CRC
 *   PNG (для проверки, что больше ничего не изменилось); xmpRewritten —
 *   JPEG пересобран из-за XMP.
 */
export function stripLocation(input) {
    if (!Buffer.isBuffer(input) || input.length < 16) {
        return {
            buffer: input,
            changed: false,
            wipedRanges: [],
            xmpRewritten: false,
        };
    }

    const buf = Buffer.from(input);
    const plans = [];

    // TIFF и RAW на его основе: структура начинается с начала файла
    const topLevel = planTiffGpsWipe(buf, 0, buf.length);
    if (topLevel) {
        plans.push(...topLevel);
    }

    // JPEG APP1 и любые встроенные блоки EXIF
    plans.push(...planEmbeddedExifWipes(buf));
    plans.push(...planCr3Wipes(buf));
    const png = planPngWipes(buf);
    plans.push(...png.plans);

    const wipedRanges = mergeRanges(plans);
    for (const [start, end] of wipedRanges) {
        buf.fill(0, start, end);
    }
    const crcRanges = [];
    for (const { typeStart, dataEnd } of png.crcFixes) {
        buf.writeUInt32BE(
            zlib.crc32(buf.subarray(typeStart, dataEnd)),
            dataEnd,
        );
        crcRanges.push([dataEnd, dataEnd + 4]);
    }

    const xmp = stripJpegXmp(buf);
    const changed = wipedRanges.length > 0 || xmp.rewritten;
    return {
        buffer: changed ? xmp.buffer : input,
        changed,
        wipedRanges: xmp.rewritten
            ? []
            : mergeRanges([...wipedRanges, ...crcRanges]),
        xmpRewritten: xmp.rewritten,
    };
}

/** Есть ли в файле ещё координаты (для проверки после очистки). */
export function hasLocation(input) {
    const result = stripLocation(input);
    return result.changed;
}
