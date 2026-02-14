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

  const COUNT_KEYS = [
    'count',
    'messageCount',
    'message_count',
    'messages',
    'totalMessages',
    'total_messages',
    'matched_messages',
    'total',
    'value',
  ];
  const TAG_KEYS = ['lastKnownTag', 'authorTag', 'userTag', 'tag', 'username', 'globalName', 'name'];
  const USER_ID_KEYS = ['userId', 'user_id', 'id', 'memberId', 'member_id', 'discordId', 'discord_id', 'uid', 'user'];
  const RESERVED_TOP_LEVEL_KEYS = new Set([
    'exported_at',
    'guild',
    'channel',
    'scan',
    'stats',
    'text_stats',
    'guilds',
    'users',
    'entries',
    'leaderboard',
    'data',
    'meta',
    'metadata',
    'version',
    'exportedAt',
    'generatedAt',
  ]);

  const normalizeUserId = (value) => {
    if (value === null || value === undefined) return null;
    const id = String(value).trim();
    return id || null;
  };

  const parseIdFromUserString = (value) => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;

    const bracketMatch = text.match(/\[(\d{5,})\]\s*$/);
    if (bracketMatch) return bracketMatch[1];

    if (/^\d{5,}$/.test(text)) return text;
    return null;
  };

  const parseTagFromUserString = (value) => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    const bracketMatch = text.match(/^(.*?)\s*\[\d{5,}\]\s*$/);
    if (!bracketMatch) return null;
    const tag = String(bracketMatch[1] || '').trim();
    return tag ? tag.slice(0, 100) : null;
  };

  const toCount = (value) => {
    if (Array.isArray(value)) return Math.max(0, Math.floor(value.length));
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
    }
    return 0;
  };

  const extractCount = (value) => {
    const direct = toCount(value);
    if (direct > 0) return direct;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return direct;

    for (const key of COUNT_KEYS) {
      if (!(key in value)) continue;
      const parsed = toCount(value[key]);
      if (parsed > 0) return parsed;
      if (value[key] === 0 || value[key] === '0') return 0;
    }

    if (value.stats && typeof value.stats === 'object') {
      for (const key of COUNT_KEYS) {
        if (!(key in value.stats)) continue;
        const parsed = toCount(value.stats[key]);
        if (parsed > 0) return parsed;
      }
    }

    return 0;
  };

  const extractTag = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const key of TAG_KEYS) {
      if (!(key in value)) continue;
      const tag = String(value[key] || '').trim();
      if (tag) return tag.slice(0, 100);
    }
    if (typeof value.user === 'string') {
      const parsed = parseTagFromUserString(value.user);
      if (parsed) return parsed;
    }
    return null;
  };

  const extractUserId = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const key of USER_ID_KEYS) {
      if (!(key in value)) continue;
      if (key === 'user') {
        const parsedId = parseIdFromUserString(value[key]);
        if (parsedId) return parsedId;
      }
      const id = normalizeUserId(value[key]);
      if (id) return id;
    }
    return null;
  };

  const pushRecord = (target, userId, value) => {
    const id = normalizeUserId(userId);
    if (!id) return;
    const count = extractCount(value);
    if (count <= 0) return;
    if (!target[id]) target[id] = { count: 0, lastKnownTag: null };
    target[id].count += count;
    const tag = extractTag(value);
    if (tag && !target[id].lastKnownTag) {
      target[id].lastKnownTag = tag;
    }
  };

  const collectFromArray = (target, values) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      pushRecord(target, extractUserId(value), value);
    }
  };

  const collectFromMap = (target, map, options = {}) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    const skipReservedTopLevel = Boolean(options.skipReservedTopLevel);
    for (const [key, value] of Object.entries(map)) {
      if (skipReservedTopLevel && RESERVED_TOP_LEVEL_KEYS.has(key)) continue;
      const userId = extractUserId(value) || key;
      pushRecord(target, userId, value);
    }
  };

  const collectFromContainer = (target, container, options = {}) => {
    if (!container || typeof container !== 'object') return;
    if (Array.isArray(container)) {
      collectFromArray(target, container);
      return;
    }

    if (Array.isArray(container.users)) {
      collectFromArray(target, container.users);
    } else if (container.users && typeof container.users === 'object') {
      collectFromMap(target, container.users);
    }

    if (Array.isArray(container.entries)) {
      collectFromArray(target, container.entries);
    }

    if (Array.isArray(container.leaderboard)) {
      collectFromArray(target, container.leaderboard);
    }

    if (container.byUser && typeof container.byUser === 'object') {
      collectFromMap(target, container.byUser);
    }

    if (container.members && typeof container.members === 'object') {
      collectFromMap(target, container.members);
    }

    if (container.stats && typeof container.stats === 'object') {
      if (Array.isArray(container.stats.per_user_totals)) {
        collectFromArray(target, container.stats.per_user_totals);
      } else if (Array.isArray(container.stats.per_user_matched)) {
        collectFromArray(target, container.stats.per_user_matched);
      }
    }

    if (options.includeAsMap) {
      collectFromMap(target, container, { skipReservedTopLevel: true });
    }
  };

  const collected = {};
  collectFromContainer(collected, payload);

  if (payload.guilds && typeof payload.guilds === 'object') {
    const guildPayload = guildId ? payload.guilds[guildId] : null;
    if (guildPayload && typeof guildPayload === 'object') {
      collectFromContainer(collected, guildPayload, { includeAsMap: true });
    } else if (!Object.keys(collected).length) {
      const guildValues = Object.values(payload.guilds).filter((value) => value && typeof value === 'object');
      if (guildValues.length === 1) {
        collectFromContainer(collected, guildValues[0], { includeAsMap: true });
      }
    }
  }

  if (payload.data && typeof payload.data === 'object') {
    collectFromContainer(collected, payload.data, { includeAsMap: true });
    if (payload.data.guilds && typeof payload.data.guilds === 'object') {
      const dataGuildPayload = guildId ? payload.data.guilds[guildId] : null;
      if (dataGuildPayload && typeof dataGuildPayload === 'object') {
        collectFromContainer(collected, dataGuildPayload, { includeAsMap: true });
      }
    }
  }

  if (!Object.keys(collected).length) {
    collectFromMap(collected, payload, { skipReservedTopLevel: true });
  }

  return Object.entries(collected)
    .filter(([, value]) => Number.isFinite(value?.count) && value.count > 0)
    .map(([userId, value]) => ({ userId, ...value }));
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
