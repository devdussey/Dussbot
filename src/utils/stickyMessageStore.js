const { ensureFile, writeJson, resolveDataPath } = require('./dataDir');
const fs = require('node:fs/promises');

const STORE_FILE = 'stickyMessages.json';

let cache = null;
let saveTimer = null;

async function ensureStore() {
  try {
    await ensureFile(STORE_FILE, { guilds: {} });
  } catch (err) {
    console.error('Failed to ensure sticky message store:', err);
  }
}

async function load() {
  if (cache) return cache;
  await ensureStore();
  try {
    const raw = await fs.readFile(resolveDataPath(STORE_FILE), 'utf8');
    const parsed = raw ? JSON.parse(raw) : { guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
    cache = parsed;
  } catch (err) {
    console.error('Failed to load sticky message store:', err);
    cache = { guilds: {} };
  }
  return cache;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!cache) return;
    try {
      if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
      await writeJson(STORE_FILE, cache);
    } catch (err) {
      console.error('Failed to persist sticky message store:', err);
    }
  }, 100);
}

function getGuild(data, guildId) {
  if (!data.guilds[guildId] || typeof data.guilds[guildId] !== 'object') {
    data.guilds[guildId] = { channels: {} };
  }
  const guild = data.guilds[guildId];
  if (!guild.channels || typeof guild.channels !== 'object') guild.channels = {};
  return guild;
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') return null;
  const mode = config.mode === 'embed' ? 'embed' : 'normal';
  const content = typeof config.content === 'string' ? config.content : '';
  const delayMs = Number.isFinite(config.delayMs) && config.delayMs > 0 ? Math.floor(config.delayMs) : 5000;
  const stickyMessageId = typeof config.stickyMessageId === 'string' ? config.stickyMessageId : null;
  const sourceMessageId = typeof config.sourceMessageId === 'string' ? config.sourceMessageId : null;
  const sourceChannelId = typeof config.sourceChannelId === 'string' ? config.sourceChannelId : null;
  return { mode, content, delayMs, stickyMessageId, sourceMessageId, sourceChannelId };
}

module.exports = {
  async setChannelConfig(guildId, channelId, config) {
    if (!guildId || !channelId || !config) return null;
    const data = await load();
    const guild = getGuild(data, guildId);
    guild.channels[channelId] = normalizeConfig(config);
    scheduleSave();
    return guild.channels[channelId];
  },

  async getChannelConfig(guildId, channelId) {
    if (!guildId || !channelId) return null;
    const data = await load();
    const guild = getGuild(data, guildId);
    return normalizeConfig(guild.channels[channelId]);
  },

  async listChannelConfigs(guildId) {
    if (!guildId) return [];
    const data = await load();
    const guild = getGuild(data, guildId);
    return Object.entries(guild.channels)
      .map(([channelId, config]) => ({ channelId, ...normalizeConfig(config) }))
      .filter(entry => entry.content || entry.sourceMessageId);
  },

  async clearChannelConfig(guildId, channelId) {
    if (!guildId || !channelId) return false;
    const data = await load();
    const guild = getGuild(data, guildId);
    if (!guild.channels[channelId]) return false;
    delete guild.channels[channelId];
    scheduleSave();
    return true;
  },

  async setStickyMessageId(guildId, channelId, stickyMessageId) {
    if (!guildId || !channelId) return null;
    const data = await load();
    const guild = getGuild(data, guildId);
    const current = normalizeConfig(guild.channels[channelId]);
    if (!current) return null;
    current.stickyMessageId = stickyMessageId ? String(stickyMessageId) : null;
    guild.channels[channelId] = current;
    scheduleSave();
    return current;
  },
};
