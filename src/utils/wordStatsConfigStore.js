const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE_NAME = 'word_stats_config.json';

let cache = null;

function ensureStoreFile() {
  try {
    ensureFileSync(STORE_FILE_NAME, { guilds: {} });
  } catch (err) {
    console.error('Failed to initialise word stats config store', err);
  }
}

function loadStore() {
  if (cache) return cache;
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(resolveDataPath(STORE_FILE_NAME), 'utf8');
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') {
      cache = { guilds: {} };
    } else {
      if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
      cache = parsed;
    }
  } catch (_err) {
    cache = { guilds: {} };
  }
  return cache;
}

function ensureGuild(guildId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = { trackedChannelId: null, users: {} };
  }
  const guild = store.guilds[guildId];
  if (!guild.users || typeof guild.users !== 'object') guild.users = {};
  return guild;
}

function normalizeUserRecord(record) {
  const count = Number.isFinite(record?.count) ? Math.max(0, Math.floor(record.count)) : 0;
  const lastKnownTag = record?.lastKnownTag ? String(record.lastKnownTag).slice(0, 100) : null;
  return { count, lastKnownTag };
}

async function saveStore() {
  const store = loadStore();
  await writeJson(STORE_FILE_NAME, store);
}

function getConfig(guildId) {
  const store = loadStore();
  const guild = store.guilds?.[guildId];
  if (!guild || typeof guild !== 'object') {
    return { trackedChannelId: null, trackedUsers: 0, totalMessages: 0 };
  }
  const users = guild.users && typeof guild.users === 'object' ? guild.users : {};
  let totalMessages = 0;
  for (const value of Object.values(users)) {
    totalMessages += Number.isFinite(value?.count) ? Math.max(0, Math.floor(value.count)) : 0;
  }
  return {
    trackedChannelId: guild.trackedChannelId || null,
    trackedUsers: Object.keys(users).length,
    totalMessages,
  };
}

async function setTrackedChannel(guildId, channelId) {
  const guild = ensureGuild(guildId);
  guild.trackedChannelId = channelId ? String(channelId) : null;
  await saveStore();
  return getConfig(guildId);
}

async function clearGuild(guildId) {
  const store = loadStore();
  if (!store.guilds?.[guildId]) return false;
  delete store.guilds[guildId];
  await saveStore();
  return true;
}

async function recordTrackedMessage(guildId, channelId, userId, userTag) {
  if (!guildId || !channelId || !userId) return { recorded: false, reason: 'missing-data' };
  const guild = ensureGuild(guildId);
  if (!guild.trackedChannelId || guild.trackedChannelId !== String(channelId)) {
    return { recorded: false, reason: 'channel-not-tracked' };
  }
  if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
    guild.users[userId] = { count: 0, lastKnownTag: null };
  }
  const entry = normalizeUserRecord(guild.users[userId]);
  entry.count += 1;
  if (userTag) entry.lastKnownTag = String(userTag).slice(0, 100);
  guild.users[userId] = entry;
  await saveStore();
  return { recorded: true, count: entry.count };
}

function parseBackfillPayload(payload, guildId) {
  if (!payload || typeof payload !== 'object') return [];

  const pushRecord = (target, userId, value) => {
    if (!userId) return;
    const id = String(userId).trim();
    if (!id) return;
    if (!target[id]) target[id] = { count: 0, lastKnownTag: null };

    const count = Number.isFinite(value?.count)
      ? Math.floor(value.count)
      : Number.isFinite(value)
        ? Math.floor(value)
        : 0;
    if (count <= 0) return;
    target[id].count += count;
    if (value?.lastKnownTag && !target[id].lastKnownTag) {
      target[id].lastKnownTag = String(value.lastKnownTag).slice(0, 100);
    }
  };

  const collected = {};
  if (Array.isArray(payload.users)) {
    for (const user of payload.users) {
      pushRecord(collected, user?.userId, user);
    }
  }

  if (payload.users && typeof payload.users === 'object' && !Array.isArray(payload.users)) {
    for (const [userId, value] of Object.entries(payload.users)) {
      pushRecord(collected, userId, value);
    }
  }

  if (payload.guilds && typeof payload.guilds === 'object' && guildId) {
    const guildPayload = payload.guilds[guildId];
    if (guildPayload?.users && typeof guildPayload.users === 'object') {
      for (const [userId, value] of Object.entries(guildPayload.users)) {
        pushRecord(collected, userId, value);
      }
    }
  }

  if (!Object.keys(collected).length) {
    for (const [userId, value] of Object.entries(payload)) {
      pushRecord(collected, userId, value);
    }
  }

  return Object.entries(collected).map(([userId, value]) => ({ userId, ...value }));
}

async function importBackfill(guildId, entries = []) {
  const guild = ensureGuild(guildId);
  let importedUsers = 0;
  let importedMessages = 0;

  for (const entry of entries) {
    const userId = String(entry?.userId || '').trim();
    if (!userId) continue;
    const count = Number.isFinite(entry?.count) ? Math.max(0, Math.floor(entry.count)) : 0;
    if (count <= 0) continue;

    if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
      guild.users[userId] = { count: 0, lastKnownTag: null };
    }
    const normalized = normalizeUserRecord(guild.users[userId]);
    normalized.count += count;
    if (entry.lastKnownTag && !normalized.lastKnownTag) {
      normalized.lastKnownTag = String(entry.lastKnownTag).slice(0, 100);
    }
    guild.users[userId] = normalized;
    importedUsers += 1;
    importedMessages += count;
  }

  await saveStore();
  return { importedUsers, importedMessages };
}

module.exports = {
  getConfig,
  setTrackedChannel,
  clearGuild,
  recordTrackedMessage,
  parseBackfillPayload,
  importBackfill,
};
