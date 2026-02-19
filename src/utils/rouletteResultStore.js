const { ensureFileSync, readJsonSync, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'rouletteResults.json';
const DEFAULT_STORE = { guilds: {} };
const HISTORY_LIMIT = 10;

let cache = null;

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const value = typeof entry.value === 'string' ? entry.value : null;
  const colorName = typeof entry.colorName === 'string' ? entry.colorName : null;
  const colorEmoji = typeof entry.colorEmoji === 'string' ? entry.colorEmoji : null;
  if (!value || !colorName || !colorEmoji) return null;
  return { value, colorName, colorEmoji };
}

function ensureLoaded() {
  if (cache) return;
  ensureFileSync(STORE_FILE, DEFAULT_STORE);
  const parsed = readJsonSync(STORE_FILE, DEFAULT_STORE);
  if (!parsed || typeof parsed !== 'object') {
    cache = { ...DEFAULT_STORE };
  } else {
    cache = { ...DEFAULT_STORE, ...parsed };
  }

  if (!cache.guilds || typeof cache.guilds !== 'object') {
    cache.guilds = {};
  }
}

function save() {
  ensureLoaded();
  writeJsonSync(STORE_FILE, cache);
}

function getHistory(guildId) {
  ensureLoaded();
  if (!guildId) return [];

  const raw = cache.guilds[guildId];
  const normalized = Array.isArray(raw)
    ? raw.map(normalizeEntry).filter(Boolean).slice(0, HISTORY_LIMIT)
    : [];

  cache.guilds[guildId] = normalized;
  return cache.guilds[guildId];
}

function recordResult(guildId, result) {
  const entry = normalizeEntry(result);
  if (!guildId || !entry) return getHistory(guildId);
  const history = getHistory(guildId);
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  save();
  return history;
}

module.exports = {
  getHistory,
  recordResult,
};
