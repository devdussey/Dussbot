const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'sacrifice_config.json';
const DEFAULT_STORE = { guilds: {} };

let cache = null;

function getStorePath() {
  return resolveDataPath(STORE_FILE);
}

function loadStore() {
  if (cache) return cache;
  try {
    ensureFileSync(STORE_FILE, DEFAULT_STORE);
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') {
      cache = { ...DEFAULT_STORE };
    } else {
      cache = { ...DEFAULT_STORE, ...parsed };
      if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
    }
  } catch (err) {
    console.error('Failed to load sacrifice config store:', err);
    cache = { ...DEFAULT_STORE };
  }
  return cache;
}

async function saveStore() {
  const safe = cache && typeof cache === 'object' ? cache : { ...DEFAULT_STORE };
  if (!safe.guilds || typeof safe.guilds !== 'object') safe.guilds = {};
  try {
    await writeJson(STORE_FILE, safe);
  } catch (err) {
    console.error('Failed to save sacrifice config store:', err);
  }
}

function ensureGuild(guildId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = { channels: {} };
  }
  const guild = store.guilds[guildId];
  if (!guild.channels || typeof guild.channels !== 'object') guild.channels = {};
  return guild;
}

function normalizeGifUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function getPanelGif(guildId, channelId) {
  if (!guildId || !channelId) return null;
  const guild = ensureGuild(guildId);
  const record = guild.channels[channelId];
  if (!record || typeof record !== 'object') return null;
  return normalizeGifUrl(record.gifUrl);
}

async function setPanelGif(guildId, channelId, gifUrl) {
  if (!guildId || !channelId) return;
  const guild = ensureGuild(guildId);
  const normalized = normalizeGifUrl(gifUrl);
  if (!normalized) {
    delete guild.channels[channelId];
    await saveStore();
    return;
  }
  guild.channels[channelId] = { gifUrl: normalized };
  await saveStore();
}

module.exports = {
  getPanelGif,
  setPanelGif,
};
