const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE_NAME = 'message_counts.json';
const MAX_LEADERBOARD_ENTRIES = 25;

let cache = null;

function getStoreFilePath() {
  return resolveDataPath(STORE_FILE_NAME);
}

function ensureStoreFile() {
  try {
    ensureFileSync(STORE_FILE_NAME, { guilds: {} });
  } catch (err) {
    console.error('Failed to initialise message count store', err);
  }
}

function loadStore() {
  if (cache) return cache;
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(getStoreFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      cache = { guilds: {} };
    } else {
      if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
      cache = parsed;
    }
  } catch (err) {
    cache = { guilds: {} };
  }
  return cache;
}

async function saveStore() {
  ensureStoreFile();
  const safe = cache && typeof cache === 'object' ? cache : { guilds: {} };
  if (!safe.guilds || typeof safe.guilds !== 'object') safe.guilds = {};
  await writeJson(STORE_FILE_NAME, safe);
}

function ensureGuildUser(guildId, userId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = { users: {} };
  }
  const guild = store.guilds[guildId];
  if (!guild.users || typeof guild.users !== 'object') guild.users = {};
  if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
    guild.users[userId] = {
      count: 0,
      lastKnownTag: null,
      lastUpdatedAt: null,
    };
  }
  const entry = guild.users[userId];
  if (!Number.isFinite(entry.count) || entry.count < 0) entry.count = 0;
  entry.count = Math.floor(entry.count);
  return entry;
}

function normalizeTag(tag) {
  if (!tag) return null;
  const text = String(tag).trim();
  if (!text) return null;
  return text.slice(0, 100);
}

async function recordMessage(guildId, userId, userTag, timestamp) {
  if (!guildId || !userId) return null;
  const entry = ensureGuildUser(guildId, userId);
  entry.count += 1;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
    entry.lastUpdatedAt = Math.floor(timestamp);
  }
  const normalizedTag = normalizeTag(userTag);
  if (normalizedTag) {
    entry.lastKnownTag = normalizedTag;
  }
  await saveStore();
  return entry;
}

function getLeaderboard(guildId, options = {}) {
  const limitRaw = Number.isFinite(options.limit) ? Math.max(0, Math.trunc(options.limit)) : 10;
  const limit = Math.min(Math.max(limitRaw || 10, 1), MAX_LEADERBOARD_ENTRIES);
  const store = loadStore();
  const guild = store.guilds[guildId];
  if (!guild || typeof guild !== 'object' || typeof guild.users !== 'object') {
    return { entries: [], totalMessages: 0, limit };
  }
  const entries = Object.entries(guild.users)
    .map(([userId, record]) => ({
      userId,
      count: Number.isFinite(record?.count) ? Math.floor(record.count) : 0,
      lastKnownTag: record?.lastKnownTag || null,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.userId.localeCompare(b.userId);
    });
  const totalMessages = entries.reduce((sum, entry) => sum + entry.count, 0);
  return {
    entries: entries.slice(0, limit),
    totalMessages,
    limit,
  };
}

module.exports = {
  recordMessage,
  getLeaderboard,
  MAX_LEADERBOARD_ENTRIES,
};
