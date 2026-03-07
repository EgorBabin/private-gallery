import path from 'path';
import { parseNumericIndexFromBase } from './deletionMarker.js';

export function parseIndexFromKey(key) {
    const baseWithExt = path.posix.basename(String(key || ''));
    const ext = path.posix.extname(baseWithExt);
    const baseNoExt = ext ? baseWithExt.slice(0, -ext.length) : baseWithExt;
    return parseNumericIndexFromBase(baseNoExt);
}

export function sortByNumericFilename(keys) {
    return keys.slice().sort((a, b) => {
        const ai = parseIndexFromKey(a) ?? 0;
        const bi = parseIndexFromKey(b) ?? 0;
        return ai - bi;
    });
}
