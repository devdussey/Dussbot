// Store for individual log channel types
// Structure: { guildId: { moderation: channelId, security: channelId, ... } }
const fs = require('fs').promises;
const { ensureFile, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'logchanneltypes.json';

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
    console.error('Failed to load log channel type store:', err);
    cache = {};
  }
}

async function persist() {
  try {
    const safe = cache && typeof cache === 'object' ? cache : {};
    await writeJson(STORE_FILE, safe);
  } catch (err) {
    console.error('Failed to write log channel type store:', err);
  }
}

// Log types supported
const LOG_TYPES = {
  moderation: 'moderation',
  security: 'security',
  message: 'message',
  member: 'member',
  role: 'role',
  channel: 'channel',
  server: 'server',
  verification: 'verification',
  invite: 'invite',
};

async function setChannel(guildId, logType, channelId) {
  await ensureLoaded();
  if (!cache[guildId]) cache[guildId] = {};
  cache[guildId][logType] = channelId;
  await persist();
  return true;
}

async function getChannel(guildId, logType) {
  await ensureLoaded();
  return cache[guildId]?.[logType] || null;
}

async function getAll(guildId) {
  await ensureLoaded();
  return cache[guildId] || {};
}

async function removeChannel(guildId, logType) {
  await ensureLoaded();
  if (cache[guildId]) {
    delete cache[guildId][logType];
    await persist();
  }
  return true;
}

async function clearGuild(guildId) {
  await ensureLoaded();
  delete cache[guildId];
  await persist();
  return true;
}

module.exports = {
  LOG_TYPES,
  setChannel,
  getChannel,
  getAll,
  removeChannel,
  clearGuild,
};
