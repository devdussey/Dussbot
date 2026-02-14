const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

// Intentionally versioned to start a fresh message corpus for new word stats/backfill flows.
const STORE_FILE_NAME = 'user_messages_v2.json';
const MAX_PER_USER = 1000;

let cache = null;

function getStoreFilePath() {
  return resolveDataPath(STORE_FILE_NAME);
}

function ensureStoreFile() {
  try {
    ensureFileSync(STORE_FILE_NAME, { guilds: {} });
  } catch (err) {
    console.error('Failed to initialise user message log store', err);
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
  if (!Array.isArray(guild.users[userId])) {
    guild.users[userId] = [];
  }
  return guild.users[userId];
}

function sanitizeContent(content) {
  if (!content) return '';
  return String(content)
    .replace(/<@!(\d+)>/g, '[@$1]')
    .replace(/<@(\d+)>/g, '[@$1]')
    .replace(/<@&(\d+)>/g, '[@role:$1]')
    .replace(/<#(\d+)>/g, '[#channel:$1]');
}

function buildEntryFromMessage(message, userId) {
  if (!message) return null;
  const contentRaw = message?.content || '';
  let cleaned = sanitizeContent(contentRaw).slice(0, 1900);
  if (!cleaned) {
    const attachments = [];
    if (message?.attachments?.size) {
      for (const att of message.attachments.values()) {
        if (!att) continue;
        if (att.name) attachments.push(att.name);
        else if (att.id) attachments.push(`attachment-${att.id}`);
        else attachments.push('attachment');
        if (attachments.length >= 3) break;
      }
    }
    if (!attachments.length && Array.isArray(message?.attachments)) {
      for (const att of message.attachments) {
        if (!att) continue;
        if (att.name) attachments.push(att.name);
        else attachments.push('attachment');
        if (attachments.length >= 3) break;
      }
    }
    if (attachments.length) {
      cleaned = `Attachments: ${attachments.join(', ')}`;
    }
  }

  const authorId = message?.author?.id || userId || null;
  const authorTag = message?.author?.tag || message?.author?.username || message?.author?.globalName || null;

  return {
    id: message?.id || null,
    channelId: message?.channelId || null,
    content: cleaned,
    createdTimestamp: Number.isFinite(message?.createdTimestamp)
      ? Number(message.createdTimestamp)
      : Date.now(),
    userId: authorId,
    authorTag,
  };
}

function trimList(list) {
  if (Array.isArray(list) && list.length > MAX_PER_USER) {
    list.splice(0, list.length - MAX_PER_USER);
  }
}

function buildEntryKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.id) return `id:${entry.id}`;
  const channelId = entry.channelId || '';
  const createdTimestamp = Number.isFinite(entry.createdTimestamp) ? entry.createdTimestamp : 0;
  const content = entry.content || '';
  return `fallback:${channelId}:${createdTimestamp}:${content}`;
}

function appendUniqueEntries(list, entries) {
  if (!Array.isArray(list) || !Array.isArray(entries) || !entries.length) return 0;
  const seen = new Set(list.map((entry) => buildEntryKey(entry)).filter(Boolean));
  let added = 0;
  for (const entry of entries) {
    const key = buildEntryKey(entry);
    if (!key || seen.has(key)) continue;
    list.push(entry);
    seen.add(key);
    added += 1;
  }
  return added;
}

async function recordMessage(guildId, userId, message) {
  if (!guildId || !userId) return;
  const entry = buildEntryFromMessage(message, userId);
  if (!entry) return;

  const list = ensureGuildUser(guildId, userId);
  appendUniqueEntries(list, [entry]);
  trimList(list);
  await saveStore();
}

async function recordMessagesBulk(guildId, userId, messages) {
  if (!guildId || !userId) return { added: 0 };
  if (!Array.isArray(messages) || !messages.length) return { added: 0 };

  const entries = messages
    .map((message) => buildEntryFromMessage(message, userId))
    .filter((entry) => entry && typeof entry === 'object');
  if (!entries.length) return { added: 0 };

  entries.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

  const list = ensureGuildUser(guildId, userId);
  const added = appendUniqueEntries(list, entries);
  trimList(list);
  await saveStore();

  return { added, total: list.length };
}

function getRecentMessages(guildId, userId, limit = MAX_PER_USER) {
  if (!guildId || !userId) return [];
  const list = ensureGuildUser(guildId, userId);
  if (!Array.isArray(list) || !list.length) return [];
  const count = Math.min(MAX_PER_USER, Math.max(0, Number(limit) || 0));
  const slice = list.slice(-count);
  return slice.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWordRegex(word) {
  const trimmed = (word || '').trim();
  if (!trimmed) return null;
  const escaped = escapeRegExp(trimmed);
  try {
    return new RegExp(`\\b${escaped}\\b`, 'gi');
  } catch (_) {
    return null;
  }
}

function searchWordUsage(guildId, word) {
  if (!guildId || !word) return { totalMatches: 0, users: [] };
  const regex = buildWordRegex(word);
  if (!regex) return { totalMatches: 0, users: [] };

  const store = loadStore();
  const guild = store.guilds[guildId];
  if (!guild || typeof guild !== 'object' || typeof guild.users !== 'object') {
    return { totalMatches: 0, users: [] };
  }

  const users = [];
  for (const [userId, messages] of Object.entries(guild.users)) {
    if (!Array.isArray(messages) || !messages.length) continue;
    let count = 0;
    let lastTag = null;
    for (const message of messages) {
      if (!message || !message.content) continue;
      if (message.authorTag) lastTag = message.authorTag;
      regex.lastIndex = 0;
      const matches = message.content.match(regex);
      if (matches && matches.length) {
        count += matches.length;
      }
    }
    if (count > 0) {
      users.push({ userId, count, authorTag: lastTag || null });
    }
  }

  users.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.userId.localeCompare(b.userId);
  });

  const totalMatches = users.reduce((sum, entry) => sum + entry.count, 0);
  return { totalMatches, users };
}

module.exports = {
  MAX_PER_USER,
  recordMessage,
  getRecentMessages,
  recordMessagesBulk,
  searchWordUsage,
};
