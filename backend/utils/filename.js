import path from 'path';

export function parseIndexFromKey(key) {
    // key может быть 'preview/2024/trips/10.jpg' или '10.jpg'
    const base = path.basename(key);
    const name = base.replace(/\.[^/.]+$/, ''); // '10'
    const n = parseInt(name, 10);
    return Number.isFinite(n) ? n : null;
}

export function sortByNumericFilename(keys) {
    return keys.slice().sort((a, b) => {
        const ai = parseIndexFromKey(a) ?? 0;
        const bi = parseIndexFromKey(b) ?? 0;
        return ai - bi;
    });
}
