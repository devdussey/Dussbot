const fs = require('fs');
const { ensureFileSync, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'sentencerush_config.json';
const DEFAULT_CONFIG = {
  minWords: 3,
  maxWords: 8,
  turnSeconds: 30,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const filePath = ensureFileSync(STORE_FILE, {});
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('Failed to load SentenceRush config store:', err);
    cache = {};
  }
  return cache;
}

function save() {
  const safe = cache && typeof cache === 'object' ? cache : {};
  writeJsonSync(STORE_FILE, safe);
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  return Math.max(min, Math.min(max, rounded));
}

function normalizeConfig(input) {
  const rawMin = clampInt(input?.minWords, 3, 8, DEFAULT_CONFIG.minWords);
  const rawMax = clampInt(input?.maxWords, 3, 8, DEFAULT_CONFIG.maxWords);
  const minWords = Math.min(rawMin, rawMax);
  const maxWords = Math.max(rawMin, rawMax);
  const turnSeconds = clampInt(input?.turnSeconds, 30, 60, DEFAULT_CONFIG.turnSeconds);
  return { minWords, maxWords, turnSeconds };
}

function getConfig(guildId) {
  if (!guildId) return { ...DEFAULT_CONFIG };
  const data = load();
  const entry = data[guildId] && typeof data[guildId] === 'object' ? data[guildId] : {};
  return normalizeConfig({ ...DEFAULT_CONFIG, ...entry });
}

function setConfig(guildId, updates) {
  if (!guildId) return { ...DEFAULT_CONFIG };
  const data = load();
  const current = data[guildId] && typeof data[guildId] === 'object' ? data[guildId] : {};
  const merged = { ...current, ...updates };
  const normalized = normalizeConfig({ ...DEFAULT_CONFIG, ...merged });
  data[guildId] = normalized;
  save();
  return normalized;
}

function clearConfig(guildId) {
  if (!guildId) return;
  const data = load();
  delete data[guildId];
  save();
}

module.exports = {
  getConfig,
  setConfig,
  clearConfig,
};
