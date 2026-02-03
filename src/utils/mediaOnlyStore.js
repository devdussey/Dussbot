const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'media_only.json';

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;

function ensureLoaded() {
  if (cache) return;
  try {
    ensureFileSync(STORE_FILE, '{}');
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    cache = raw ? JSON.parse(raw) : {};
    if (!cache || typeof cache !== 'object') cache = {};
  } catch (err) {
    console.error('Failed to load media-only store:', err);
    cache = {};
  }
}

function persist() {
  const safe = cache && typeof cache === 'object' ? cache : {};
  writeJsonSync(STORE_FILE, safe);
}

function getGuildConfig(guildId) {
  ensureLoaded();
  if (!cache[guildId]) {
    cache[guildId] = { channels: [] };
    persist();
  }
  const cfg = cache[guildId];
  if (!Array.isArray(cfg.channels)) cfg.channels = [];
  return cfg;
}

function isChannelMediaOnly(guildId, channelId) {
  const cfg = getGuildConfig(guildId);
  return cfg.channels.includes(channelId);
}

function setChannel(guildId, channelId, enabled) {
  const cfg = getGuildConfig(guildId);
  const existing = new Set(cfg.channels);
  if (enabled) {
    existing.add(channelId);
  } else {
    existing.delete(channelId);
  }
  cfg.channels = Array.from(existing);
  persist();
  return enabled;
}

function listChannels(guildId) {
  const cfg = getGuildConfig(guildId);
  return cfg.channels.slice();
}

module.exports = {
  getGuildConfig,
  isChannelMediaOnly,
  setChannel,
  listChannels,
};
