const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE_NAME = 'word_stats_config.json';
const WORD_TOKEN_REGEX = /[a-z0-9]+(?:['_-][a-z0-9]+)*/gi;
const CUSTOM_EMOJI_REGEX = /<a?:[A-Za-z0-9_]+:\d+>/g;
const IMAGE_ATTACHMENT_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff|apng|heic|avif|svg)(?:[?#].*)?$/i;
const MAX_QUERY_LIMIT = 50;
const MAX_WORD_LENGTH = 48;

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

function toNonNegativeInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
}

function normalizeTag(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 100);
}

function normalizeWordToken(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/[a-z0-9]+(?:['_-][a-z0-9]+)*/);
  if (!match) return null;
  const token = match[0]
    .replace(/^['_-]+/, '')
    .replace(/['_-]+$/, '')
    .slice(0, MAX_WORD_LENGTH);
  return token || null;
}

function mergeWordMaps(target, incoming) {
  if (!target || typeof target !== 'object') return;
  if (!incoming || typeof incoming !== 'object') return;
  for (const [rawWord, rawCount] of Object.entries(incoming)) {
    const word = normalizeWordToken(rawWord);
    const count = toNonNegativeInt(rawCount);
    if (!word || count <= 0) continue;
    target[word] = (target[word] || 0) + count;
  }
}

function normalizeWordMap(words) {
  const normalized = {};
  mergeWordMaps(normalized, words);
  return normalized;
}

function normalizeMediaBreakdown(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    images: toNonNegativeInt(source.images ?? source.image ?? source.imageCount ?? source.image_count),
    stickers: toNonNegativeInt(source.stickers ?? source.sticker ?? source.stickerCount ?? source.sticker_count),
    emojis: toNonNegativeInt(source.emojis ?? source.emoji ?? source.emojiCount ?? source.emoji_count),
  };
}

function normalizeUserRecord(record) {
  let count = toNonNegativeInt(record?.count);
  const lastKnownTag = normalizeTag(record?.lastKnownTag);
  let textCount = toNonNegativeInt(record?.textCount ?? record?.textMessages ?? record?.text_messages);
  let mediaCount = toNonNegativeInt(record?.mediaCount ?? record?.mediaMessages ?? record?.media_messages);
  const mediaBreakdown = normalizeMediaBreakdown(
    record?.mediaBreakdown ?? record?.media_breakdown ?? record?.mediaStats ?? record?.media_stats ?? record?.media,
  );
  const words = normalizeWordMap(
    record?.words ?? record?.wordCounts ?? record?.word_counts ?? record?.topWords ?? record?.top_words,
  );

  if (mediaCount <= 0) {
    const mediaByBreakdown = mediaBreakdown.images + mediaBreakdown.stickers + mediaBreakdown.emojis;
    if (mediaByBreakdown > 0) mediaCount = mediaByBreakdown;
  }

  if (textCount <= 0 && mediaCount <= 0 && count > 0) {
    textCount = count;
  }

  const classifiedTotal = textCount + mediaCount;
  if (count < classifiedTotal) count = classifiedTotal;

  return {
    count,
    lastKnownTag,
    textCount,
    mediaCount,
    mediaBreakdown,
    words,
  };
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
    totalMessages += normalizeUserRecord(value).count;
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

function getCollectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return Array.from(value.values());
  return [];
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  const contentType = String(attachment.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const name = String(attachment.name || attachment.url || '').toLowerCase();
  return IMAGE_ATTACHMENT_EXT_RE.test(name);
}

function countEmojisInText(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return 0;

  const customEmojiMatches = text.match(CUSTOM_EMOJI_REGEX);
  const customCount = customEmojiMatches ? customEmojiMatches.length : 0;
  const noCustom = text.replace(CUSTOM_EMOJI_REGEX, ' ');

  let unicodeCount = 0;
  try {
    const unicodeMatches = noCustom.match(/\p{Extended_Pictographic}/gu);
    unicodeCount = unicodeMatches ? unicodeMatches.length : 0;
  } catch (_) {
    unicodeCount = 0;
  }

  return customCount + unicodeCount;
}

function extractWordMapFromText(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return {};
  const cleaned = text
    .replace(CUSTOM_EMOJI_REGEX, ' ')
    .replace(/<@!?(\d+)>/g, ' ')
    .replace(/<@&(\d+)>/g, ' ')
    .replace(/<#(\d+)>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ');

  const tokens = cleaned.match(WORD_TOKEN_REGEX) || [];
  const words = {};
  for (const token of tokens) {
    const normalized = normalizeWordToken(token);
    if (!normalized) continue;
    words[normalized] = (words[normalized] || 0) + 1;
  }
  return words;
}

function extractMessageStats(message) {
  if (!message || typeof message !== 'object') {
    return {
      textCount: 1,
      mediaCount: 0,
      mediaBreakdown: { images: 0, stickers: 0, emojis: 0 },
      words: {},
    };
  }

  const content = String(message.content || '');
  const words = extractWordMapFromText(content);
  const imageCount = getCollectionValues(message.attachments).filter((attachment) => isImageAttachment(attachment)).length;
  const stickerCount = getCollectionValues(message.stickers).length;
  const emojiCount = countEmojisInText(content);
  const hasMedia = imageCount > 0 || stickerCount > 0 || emojiCount > 0;

  return {
    textCount: hasMedia ? 0 : 1,
    mediaCount: hasMedia ? 1 : 0,
    mediaBreakdown: {
      images: imageCount,
      stickers: stickerCount,
      emojis: emojiCount,
    },
    words,
  };
}

async function recordTrackedMessage(guildId, channelId, userId, userTag, message) {
  if (!guildId || !channelId || !userId) return { recorded: false, reason: 'missing-data' };
  const guild = ensureGuild(guildId);
  if (!guild.trackedChannelId || guild.trackedChannelId !== String(channelId)) {
    return { recorded: false, reason: 'channel-not-tracked' };
  }
  if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
    guild.users[userId] = {
      count: 0,
      lastKnownTag: null,
      textCount: 0,
      mediaCount: 0,
      mediaBreakdown: { images: 0, stickers: 0, emojis: 0 },
      words: {},
    };
  }

  const entry = normalizeUserRecord(guild.users[userId]);
  entry.count += 1;
  const messageStats = extractMessageStats(message);
  entry.textCount += messageStats.textCount;
  entry.mediaCount += messageStats.mediaCount;
  entry.mediaBreakdown.images += messageStats.mediaBreakdown.images;
  entry.mediaBreakdown.stickers += messageStats.mediaBreakdown.stickers;
  entry.mediaBreakdown.emojis += messageStats.mediaBreakdown.emojis;
  mergeWordMaps(entry.words, messageStats.words);
  if (userTag) entry.lastKnownTag = normalizeTag(userTag);
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
  const TEXT_COUNT_KEYS = ['textCount', 'text_count', 'textMessages', 'text_messages', 'plainTextMessages', 'plain_text_messages'];
  const MEDIA_COUNT_KEYS = ['mediaCount', 'media_count', 'mediaMessages', 'media_messages'];
  const WORD_KEYS = ['words', 'wordCounts', 'word_counts', 'topWords', 'top_words'];
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

  const normalizeCountResult = (value, found = false) => ({
    value: toCount(value),
    found,
  });

  const extractCountByKeys = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return normalizeCountResult(0, false);
    for (const key of keys) {
      if (!(key in value)) continue;
      return normalizeCountResult(value[key], true);
    }
    if (value.stats && typeof value.stats === 'object') {
      for (const key of keys) {
        if (!(key in value.stats)) continue;
        return normalizeCountResult(value.stats[key], true);
      }
    }
    return normalizeCountResult(0, false);
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

  const mergeCandidateWordMap = (target, candidate) => {
    if (!candidate) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (!item || typeof item !== 'object') continue;
        const word = normalizeWordToken(item.word ?? item.token ?? item.key ?? item.name);
        const count = toCount(item.count ?? item.value ?? item.uses ?? item.total);
        if (!word || count <= 0) continue;
        target[word] = (target[word] || 0) + count;
      }
      return;
    }
    if (typeof candidate !== 'object') return;
    for (const [wordKey, countValue] of Object.entries(candidate)) {
      const word = normalizeWordToken(wordKey);
      const count = toCount(countValue);
      if (!word || count <= 0) continue;
      target[word] = (target[word] || 0) + count;
    }
  };

  const extractWordMap = (value) => {
    const words = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return words;

    for (const key of WORD_KEYS) {
      if (!(key in value)) continue;
      mergeCandidateWordMap(words, value[key]);
    }

    if (value.stats && typeof value.stats === 'object') {
      for (const key of WORD_KEYS) {
        if (!(key in value.stats)) continue;
        mergeCandidateWordMap(words, value.stats[key]);
      }
    }

    return words;
  };

  const extractMediaBreakdown = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { hasAny: false, images: 0, stickers: 0, emojis: 0 };
    }

    const directCandidate = value.mediaBreakdown || value.media_breakdown || value.media || null;
    const statsCandidate = value.stats && typeof value.stats === 'object'
      ? (value.stats.mediaBreakdown || value.stats.media_breakdown || value.stats.media || null)
      : null;

    const candidate = directCandidate && typeof directCandidate === 'object'
      ? directCandidate
      : statsCandidate && typeof statsCandidate === 'object'
        ? statsCandidate
        : null;

    if (!candidate) {
      return { hasAny: false, images: 0, stickers: 0, emojis: 0 };
    }

    const normalized = normalizeMediaBreakdown(candidate);
    const total = normalized.images + normalized.stickers + normalized.emojis;
    return { hasAny: total > 0, ...normalized };
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
    const textCountResult = extractCountByKeys(value, TEXT_COUNT_KEYS);
    const mediaCountResult = extractCountByKeys(value, MEDIA_COUNT_KEYS);
    const mediaBreakdown = extractMediaBreakdown(value);
    const words = extractWordMap(value);
    const wordTotal = Object.values(words).reduce((sum, amount) => sum + amount, 0);
    const hasMediaDetails = mediaCountResult.found || mediaBreakdown.hasAny;
    const hasTextDetails = textCountResult.found;
    const hasClassifiedDetails = hasTextDetails || hasMediaDetails;

    let normalizedCount = count;
    if (normalizedCount <= 0) {
      normalizedCount = textCountResult.value + mediaCountResult.value;
    }
    if (normalizedCount <= 0 && wordTotal > 0) {
      normalizedCount = wordTotal;
    }
    if (normalizedCount <= 0) return;

    if (!target[id]) {
      target[id] = {
        count: 0,
        lastKnownTag: null,
        textCount: 0,
        mediaCount: 0,
        mediaBreakdown: { images: 0, stickers: 0, emojis: 0 },
        words: {},
      };
    }

    target[id].count += normalizedCount;
    if (!hasClassifiedDetails) {
      target[id].textCount += normalizedCount;
    } else {
      const normalizedMediaCount = mediaCountResult.found
        ? mediaCountResult.value
        : (mediaBreakdown.images + mediaBreakdown.stickers + mediaBreakdown.emojis);
      const normalizedTextCount = textCountResult.value;
      const classified = normalizedTextCount + normalizedMediaCount;
      target[id].textCount += normalizedTextCount;
      target[id].mediaCount += normalizedMediaCount;
      if (classified < normalizedCount) {
        target[id].textCount += (normalizedCount - classified);
      }
    }

    target[id].mediaBreakdown.images += mediaBreakdown.images;
    target[id].mediaBreakdown.stickers += mediaBreakdown.stickers;
    target[id].mediaBreakdown.emojis += mediaBreakdown.emojis;
    mergeWordMaps(target[id].words, words);

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
    .map(([userId, value]) => ({ userId, ...normalizeUserRecord(value) }))
    .filter((entry) => entry.count > 0);
}

async function importBackfill(guildId, entries = []) {
  const guild = ensureGuild(guildId);
  let importedUsers = 0;
  let importedMessages = 0;

  for (const entry of entries) {
    const userId = String(entry?.userId || '').trim();
    if (!userId) continue;
    const incoming = normalizeUserRecord(entry);
    if (incoming.count <= 0) continue;

    if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
      guild.users[userId] = {
        count: 0,
        lastKnownTag: null,
        textCount: 0,
        mediaCount: 0,
        mediaBreakdown: { images: 0, stickers: 0, emojis: 0 },
        words: {},
      };
    }
    const normalized = normalizeUserRecord(guild.users[userId]);
    normalized.count += incoming.count;
    normalized.textCount += incoming.textCount;
    normalized.mediaCount += incoming.mediaCount;
    normalized.mediaBreakdown.images += incoming.mediaBreakdown.images;
    normalized.mediaBreakdown.stickers += incoming.mediaBreakdown.stickers;
    normalized.mediaBreakdown.emojis += incoming.mediaBreakdown.emojis;
    mergeWordMaps(normalized.words, incoming.words);

    if (entry.lastKnownTag && !normalized.lastKnownTag) {
      normalized.lastKnownTag = normalizeTag(entry.lastKnownTag);
    }
    guild.users[userId] = normalized;
    importedUsers += 1;
    importedMessages += incoming.count;
  }

  await saveStore();
  return { importedUsers, importedMessages };
}

function normalizeLimit(limit, fallback = 10) {
  const parsed = toNonNegativeInt(limit);
  const resolved = parsed > 0 ? parsed : fallback;
  return Math.min(Math.max(resolved, 1), MAX_QUERY_LIMIT);
}

function getGuildSnapshot(guildId) {
  const store = loadStore();
  const guild = store.guilds?.[guildId];
  if (!guild || typeof guild !== 'object') {
    return { trackedChannelId: null, users: [] };
  }

  const users = [];
  const records = guild.users && typeof guild.users === 'object' ? guild.users : {};
  for (const [userId, rawRecord] of Object.entries(records)) {
    const record = normalizeUserRecord(rawRecord);
    records[userId] = record;
    if (record.count <= 0) continue;
    users.push({ userId, ...record });
  }

  return {
    trackedChannelId: guild.trackedChannelId || null,
    users,
  };
}

function sortByCountThenId(aCount, aId, bCount, bId) {
  if (bCount !== aCount) return bCount - aCount;
  return String(aId).localeCompare(String(bId));
}

function getTopUsers(guildId, limit = 10) {
  const normalizedLimit = normalizeLimit(limit);
  const snapshot = getGuildSnapshot(guildId);
  const sorted = snapshot.users
    .slice()
    .sort((a, b) => sortByCountThenId(a.count, a.userId, b.count, b.userId));

  const totals = {
    totalMessages: 0,
    textMessages: 0,
    mediaMessages: 0,
  };
  for (const entry of snapshot.users) {
    totals.totalMessages += entry.count;
    totals.textMessages += entry.textCount;
    totals.mediaMessages += entry.mediaCount;
  }

  return {
    entries: sorted.slice(0, normalizedLimit).map((entry) => ({
      ...entry,
      mediaItemsTotal: entry.mediaBreakdown.images + entry.mediaBreakdown.stickers + entry.mediaBreakdown.emojis,
    })),
    totals,
    limit: normalizedLimit,
  };
}

function getTopMediaUsers(guildId, limit = 10) {
  const normalizedLimit = normalizeLimit(limit);
  const snapshot = getGuildSnapshot(guildId);
  const entries = snapshot.users
    .map((entry) => ({
      ...entry,
      mediaItemsTotal: entry.mediaBreakdown.images + entry.mediaBreakdown.stickers + entry.mediaBreakdown.emojis,
    }))
    .filter((entry) => entry.mediaCount > 0 || entry.mediaItemsTotal > 0)
    .sort((a, b) => {
      if (b.mediaCount !== a.mediaCount) return b.mediaCount - a.mediaCount;
      if (b.mediaItemsTotal !== a.mediaItemsTotal) return b.mediaItemsTotal - a.mediaItemsTotal;
      return String(a.userId).localeCompare(String(b.userId));
    });

  const totals = {
    mediaMessages: 0,
    imagePosts: 0,
    stickerPosts: 0,
    emojiPosts: 0,
  };

  for (const entry of snapshot.users) {
    totals.mediaMessages += entry.mediaCount;
    totals.imagePosts += entry.mediaBreakdown.images;
    totals.stickerPosts += entry.mediaBreakdown.stickers;
    totals.emojiPosts += entry.mediaBreakdown.emojis;
  }

  return {
    entries: entries.slice(0, normalizedLimit),
    totals,
    limit: normalizedLimit,
  };
}

function getTopWords(guildId, limit = 10) {
  const normalizedLimit = normalizeLimit(limit);
  const snapshot = getGuildSnapshot(guildId);
  const byWord = new Map();

  for (const user of snapshot.users) {
    for (const [word, rawCount] of Object.entries(user.words || {})) {
      const count = toNonNegativeInt(rawCount);
      if (count <= 0) continue;

      if (!byWord.has(word)) {
        byWord.set(word, {
          word,
          totalCount: 0,
          topUserId: user.userId,
          topUserTag: user.lastKnownTag || null,
          topUserCount: 0,
        });
      }

      const bucket = byWord.get(word);
      bucket.totalCount += count;

      if (count > bucket.topUserCount) {
        bucket.topUserCount = count;
        bucket.topUserId = user.userId;
        bucket.topUserTag = user.lastKnownTag || null;
      } else if (count === bucket.topUserCount && String(user.userId).localeCompare(String(bucket.topUserId)) < 0) {
        bucket.topUserId = user.userId;
        bucket.topUserTag = user.lastKnownTag || null;
      }
    }
  }

  const entries = Array.from(byWord.values()).sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return a.word.localeCompare(b.word);
  });

  return {
    entries: entries.slice(0, normalizedLimit),
    uniqueWords: entries.length,
    totalWordUses: entries.reduce((sum, entry) => sum + entry.totalCount, 0),
    limit: normalizedLimit,
  };
}

function searchWordUsage(guildId, word, limit = 10) {
  const normalizedLimit = normalizeLimit(limit);
  const normalizedWord = normalizeWordToken(word);
  if (!normalizedWord) {
    return { word: null, totalMatches: 0, users: [], limit: normalizedLimit };
  }

  const snapshot = getGuildSnapshot(guildId);
  const users = [];
  for (const entry of snapshot.users) {
    const count = toNonNegativeInt(entry.words?.[normalizedWord]);
    if (count <= 0) continue;
    users.push({
      userId: entry.userId,
      lastKnownTag: entry.lastKnownTag || null,
      count,
    });
  }

  users.sort((a, b) => sortByCountThenId(a.count, a.userId, b.count, b.userId));

  return {
    word: normalizedWord,
    totalMatches: users.reduce((sum, entry) => sum + entry.count, 0),
    users: users.slice(0, normalizedLimit),
    limit: normalizedLimit,
  };
}

function getUserWordStats(guildId, userId, limit = 10) {
  if (!guildId || !userId) return null;
  const normalizedLimit = normalizeLimit(limit);
  const snapshot = getGuildSnapshot(guildId);
  const user = snapshot.users.find((entry) => String(entry.userId) === String(userId));
  if (!user) return null;

  const topWords = Object.entries(user.words || {})
    .map(([word, rawCount]) => ({ word, count: toNonNegativeInt(rawCount) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.word.localeCompare(b.word);
    });

  return {
    userId: user.userId,
    lastKnownTag: user.lastKnownTag || null,
    count: user.count,
    textCount: user.textCount,
    mediaCount: user.mediaCount,
    mediaBreakdown: user.mediaBreakdown,
    uniqueWordCount: topWords.length,
    totalWordUses: topWords.reduce((sum, entry) => sum + entry.count, 0),
    topWords: topWords.slice(0, normalizedLimit),
    limit: normalizedLimit,
  };
}

module.exports = {
  getConfig,
  setTrackedChannel,
  clearGuild,
  recordTrackedMessage,
  parseBackfillPayload,
  importBackfill,
  normalizeWordToken,
  getTopUsers,
  getTopMediaUsers,
  getTopWords,
  searchWordUsage,
  getUserWordStats,
};
