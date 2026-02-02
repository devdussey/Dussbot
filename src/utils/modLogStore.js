const fs = require('fs').promises;
const { ensureFile, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'modlog.json';

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;

async function ensureLoaded() {
  if (cache) return;
  try {
    await ensureFile(STORE_FILE, '{}');
    const raw = await fs.readFile(getDataFile(), 'utf8').catch(err => {
      if (err?.code === 'ENOENT') return '{}';
      throw err;
    });
    cache = JSON.parse(raw || '{}');
  } catch (err) {
    console.error('Failed to load mod log store:', err);
    cache = {};
  }
}

async function ensureGuild(guildId) {
  await ensureLoaded();
  let cur = cache[guildId];
  if (!cur || typeof cur !== 'object') {
    cur = {
      channelId: typeof cur === 'string' ? cur : null,
      moderatorRoleId: null,
      mode: 'channel',
      enabled: true,
    };
    cache[guildId] = cur;
    return cur;
  }
  if (!Object.prototype.hasOwnProperty.call(cur, 'channelId')) {
    cur.channelId = null;
  }
  if (!Object.prototype.hasOwnProperty.call(cur, 'moderatorRoleId')) {
    cur.moderatorRoleId = null;
  }
  if (!Object.prototype.hasOwnProperty.call(cur, 'mode')) {
    cur.mode = 'channel';
  }
  if (!Object.prototype.hasOwnProperty.call(cur, 'enabled')) {
    cur.enabled = true;
  }
  return cur;
}

async function persist() {
  try {
    const safe = cache && typeof cache === 'object' ? cache : {};
    await writeJson(STORE_FILE, safe);
  } catch (err) {
    console.error('Failed to write mod log store:', err);
  }
}

async function get(guildId) {
  const g = await ensureGuild(guildId);
  return g.channelId || null;
}

async function set(guildId, channelId) {
  const g = await ensureGuild(guildId);
  g.channelId = channelId;
  await persist();
}

async function clear(guildId) {
  await ensureLoaded();
  delete cache[guildId];
  await persist();
}

async function getMode(guildId) {
  const g = await ensureGuild(guildId);
  return g.mode || 'channel';
}

async function setMode(guildId, mode) {
  const g = await ensureGuild(guildId);
  g.mode = mode;
  await persist();
}

async function getEnabled(guildId) {
  const g = await ensureGuild(guildId);
  return typeof g.enabled === 'boolean' ? g.enabled : true;
}

async function setEnabled(guildId, enabled) {
  const g = await ensureGuild(guildId);
  g.enabled = !!enabled;
  await persist();
}

async function getModeratorRole(guildId) {
  const g = await ensureGuild(guildId);
  return g.moderatorRoleId || null;
}

async function setModeratorRole(guildId, roleId) {
  const g = await ensureGuild(guildId);
  g.moderatorRoleId = roleId ? String(roleId) : null;
  await persist();
}

async function getConfig(guildId) {
  const g = await ensureGuild(guildId);
  return {
    channelId: g.channelId || null,
    moderatorRoleId: g.moderatorRoleId || null,
    mode: g.mode || 'channel',
    enabled: typeof g.enabled === 'boolean' ? g.enabled : true,
  };
}

module.exports = {
  get,
  set,
  clear,
  getMode,
  setMode,
  getEnabled,
  setEnabled,
  getModeratorRole,
  setModeratorRole,
  getConfig,
};
