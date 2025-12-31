const { ensureFileSync, readJsonSync, writeJson } = require('./dataDir');

const STORE_FILE = 'leave_tracker.json';
let cache = null;

function ensureStore() {
  try {
    ensureFileSync(STORE_FILE, { guilds: {} });
  } catch (err) {
    console.error('Failed to ensure leave tracker store:', err);
  }
}

function loadStore() {
  if (cache) return cache;
  ensureStore();
  try {
    const data = readJsonSync(STORE_FILE, { guilds: {} });
    if (data && typeof data === 'object' && typeof data.guilds === 'object') {
      cache = data;
    } else {
      cache = { guilds: {} };
    }
  } catch (err) {
    console.error('Failed to load leave tracker store:', err);
    cache = { guilds: {} };
  }
  return cache;
}

async function saveStore() {
  const store = loadStore();
  const safe = store && typeof store === 'object' ? store : { guilds: {} };
  if (!safe.guilds || typeof safe.guilds !== 'object') safe.guilds = {};
  await writeJson(STORE_FILE, safe);
}

function normalizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || !cfg.channelId) return null;
  return {
    channelId: String(cfg.channelId),
    enabled: cfg.enabled !== false,
    updatedAt: cfg.updatedAt || null,
    updatedBy: cfg.updatedBy || null,
  };
}

function getConfig(guildId) {
  if (!guildId) return null;
  const store = loadStore();
  return normalizeConfig(store.guilds[guildId]);
}

async function setConfig(guildId, channelId, meta = {}) {
  if (!guildId || !channelId) return null;
  const store = loadStore();
  store.guilds[guildId] = {
    channelId: String(channelId),
    enabled: true,
    updatedAt: new Date().toISOString(),
    updatedBy: meta.updatedBy || null,
  };
  await saveStore();
  return getConfig(guildId);
}

async function disable(guildId) {
  if (!guildId) return null;
  const store = loadStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId].enabled = false;
  store.guilds[guildId].updatedAt = new Date().toISOString();
  await saveStore();
  return getConfig(guildId);
}

module.exports = {
  getConfig,
  setConfig,
  disable,
};
