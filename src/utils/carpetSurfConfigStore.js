const fs = require('fs');
const { ensureFileSync, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'carpetsurf_config.json';
const DEFAULT_CONFIG = {
  enabled: false,
  channelId: null,
  intervalMinutes: 60,
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
    console.error('Failed to load CarpetSurf config store:', err);
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
  const enabled = Boolean(input?.enabled);
  const channelId = input?.channelId ? String(input.channelId) : null;
  const intervalMinutes = clampInt(input?.intervalMinutes, 1, 1440, DEFAULT_CONFIG.intervalMinutes);
  return { enabled, channelId, intervalMinutes };
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

module.exports = {
  getConfig,
  setConfig,
};
