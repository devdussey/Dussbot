const DEFAULT_MAX_WORDS_PER_MESSAGE = 500;
const WORD_PATTERN = /[\p{L}\p{N}'’\-]+/gu;
const MAX_WORD_LENGTH = 40;

function normalizeWord(value) {
    if (!value) return null;
    let text = String(value).trim().normalize('NFC').toLowerCase();
    if (!text) return null;
    text = text.replace(/’/g, "'");
    text = text.replace(/^[\-']+|[\-']+$/g, '');
    if (!text) return null;
    text = text.slice(0, MAX_WORD_LENGTH);
    text = text.replace(/[^a-z0-9\-']+/g, '');
    if (!text) return null;
    return text;
}

function extractWords(value, options = {}) {
    const raw = String(value || '');
    if (!raw.trim()) return [];
    const limit = Math.max(Number.isFinite(options.maxWords) ? options.maxWords : DEFAULT_MAX_WORDS_PER_MESSAGE, 1);
    const matches = raw.match(WORD_PATTERN);
    if (!matches || !matches.length) return [];
    const words = [];
    for (const match of matches) {
        if (words.length >= limit) break;
        const normalized = normalizeWord(match);
        if (normalized) words.push(normalized);
    }
    return words;
}

module.exports = {
    extractWords,
    normalizeWord,
    DEFAULT_MAX_WORDS_PER_MESSAGE,
};
