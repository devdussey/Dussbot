const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGE_SIZE = 100;
const WORD_TOKEN_REGEX = /[A-Za-z0-9']+/g;
const IMAGE_ATTACHMENT_RE = /\.(png|jpe?g|webp)(?:[?#].*)?$/i;
const GIF_ATTACHMENT_RE = /\.gif(?:[?#].*)?$/i;
const MEDIA_LINK_RE = /(https?:\/\/[^\s<>]+)/gi;
const DEFAULT_TOP_WORDS_LIMIT = 250;
const DEFAULT_USER_TOP_WORDS_LIMIT = 50;
const DEFAULT_DEDUPE_WINDOW = 10000;

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', "aren't", 'as',
  'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', "can't", 'cannot',
  'could', "couldn't", 'did', "didn't", 'do', 'does', "doesn't", 'doing', "don't", 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'had', "hadn't", 'has', "hasn't", 'have', "haven't", 'having', 'he', "he'd",
  "he'll", "he's", 'her', 'here', "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how', "how's", 'i',
  "i'd", "i'll", "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its', 'itself', "let's", 'me',
  'more', 'most', "mustn't", 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', "shan't", 'she', "she'd", "she'll", "she's",
  'should', "shouldn't", 'so', 'some', 'such', 'than', 'that', "that's", 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', "there's", 'these', 'they', "they'd", "they'll", "they're", "they've", 'this',
  'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', "wasn't", 'we', "we'd", "we'll", "we're",
  "we've", 'were', "weren't", 'what', "what's", 'when', "when's", 'where', "where's", 'which', 'while', 'who',
  "who's", 'whom', 'why', "why's", 'with', "won't", 'would', "wouldn't", 'you', "you'd", "you'll", "you're",
  "you've", 'your', 'yours', 'yourself', 'yourselves',
]);

const ACTIVE_SCAN_KEYS = new Set();

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
}

function sanitizeFilePart(value, fallback = 'unknown') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return cleaned.slice(0, 64);
}

function utcTimestampForFile(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sleep(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function toBooleanFromEnv(value, defaultValue) {
  if (value === null || value === undefined || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function toPositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function toNonNegativeNumber(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function parseUtcInput(rawValue, boundary, label) {
  if (rawValue === null || rawValue === undefined) return null;
  const text = String(rawValue).trim();
  if (!text) return null;

  const simpleDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (simpleDateMatch) {
    const year = Number(simpleDateMatch[1]);
    const month = Number(simpleDateMatch[2]);
    const day = Number(simpleDateMatch[3]);
    if (boundary === 'end') {
      return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
    }
    return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  }

  const hasTimezone = /z$/i.test(text) || /[+-]\d{2}:\d{2}$/.test(text);
  if (!hasTimezone) {
    throw new Error(`${label} must be UTC (include a trailing 'Z' or timezone offset).`);
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid UTC date/time.`);
  }
  return parsed;
}

function resolveRuntimeSettings() {
  const fastMode = toBooleanFromEnv(process.env.FAST_MODE, false);
  const useStopwords = toBooleanFromEnv(process.env.USE_STOPWORDS, true);

  const requestDelaySeconds = toNonNegativeNumber(
    process.env.REQUEST_DELAY,
    fastMode ? 0 : 0.1,
  );

  const progressEveryMessages = toPositiveInt(
    process.env.SCAN_PROGRESS_EVERY_MESSAGES,
    fastMode ? 2500 : 300,
  );
  const checkpointEveryMessages = toPositiveInt(
    process.env.SCAN_CHECKPOINT_EVERY_MESSAGES,
    fastMode ? 7000 : 800,
  );

  const progressEveryMs = toPositiveInt(
    process.env.SCAN_PROGRESS_EVERY_MS,
    fastMode ? 12000 : 4500,
  );
  const checkpointEveryMs = toPositiveInt(
    process.env.SCAN_CHECKPOINT_EVERY_MS,
    fastMode ? 20000 : 8000,
  );

  return {
    fastMode,
    useStopwords,
    requestDelaySeconds,
    requestDelayMs: Math.max(0, Math.floor(requestDelaySeconds * 1000)),
    pageSize: PAGE_SIZE,
    progressEveryMessages,
    checkpointEveryMessages,
    progressEveryMs,
    checkpointEveryMs,
    topWordsLimit: toPositiveInt(process.env.TOP_WORDS_LIMIT, DEFAULT_TOP_WORDS_LIMIT),
    userTopWordsLimit: toPositiveInt(process.env.USER_TOP_WORDS_LIMIT, DEFAULT_USER_TOP_WORDS_LIMIT),
    dedupeWindow: toPositiveInt(process.env.SCAN_DEDUPE_WINDOW, DEFAULT_DEDUPE_WINDOW),
  };
}

function classifyAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  const name = String(attachment?.name || attachment?.url || '').toLowerCase();
  const isGif = contentType === 'image/gif' || GIF_ATTACHMENT_RE.test(name);
  if (isGif) return { hasImage: false, hasGif: true };
  const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(contentType) || IMAGE_ATTACHMENT_RE.test(name);
  if (isImage) return { hasImage: true, hasGif: false };
  return { hasImage: false, hasGif: false };
}

function hasEmbedMedia(embeds) {
  const list = Array.isArray(embeds) ? embeds : [];
  for (const embed of list) {
    if (!embed || typeof embed !== 'object') continue;
    if (embed.image || embed.thumbnail || embed.video) return true;
  }
  return false;
}

function hasGifLikeMediaLink(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return false;

  const links = text.match(MEDIA_LINK_RE) || [];
  for (const rawLink of links) {
    let parsed = null;
    try {
      parsed = new URL(rawLink);
    } catch (_) {
      parsed = null;
    }

    if (!parsed) {
      if (/(tenor\.com|giphy\.com|discordapp\.com|discordapp\.net)/i.test(rawLink)) {
        return true;
      }
      continue;
    }

    const host = String(parsed.hostname || '').toLowerCase();
    const pathname = String(parsed.pathname || '').toLowerCase();
    if (host.endsWith('tenor.com') || host.endsWith('giphy.com')) return true;
    if (host.endsWith('discordapp.com') || host.endsWith('discordapp.net')) {
      if (pathname.includes('/attachments/')) return true;
      if (/\.(gif|mp4|webm|png|jpe?g|webp)$/.test(pathname)) return true;
    }
  }

  return false;
}

function classifyMessageMedia(message) {
  const attachments = message?.attachments
    ? Array.from(typeof message.attachments.values === 'function' ? message.attachments.values() : message.attachments)
    : [];
  const stickers = message?.stickers
    ? Array.from(typeof message.stickers.values === 'function' ? message.stickers.values() : message.stickers)
    : [];
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];

  let hasImage = false;
  let hasGif = false;
  for (const attachment of attachments) {
    const classified = classifyAttachment(attachment);
    if (classified.hasImage) hasImage = true;
    if (classified.hasGif) hasGif = true;
  }

  const hasSticker = stickers.length > 0;
  if (hasEmbedMedia(embeds)) hasGif = true;
  if (hasGifLikeMediaLink(message?.content || '')) hasGif = true;

  const mediaAny = hasImage || hasGif || hasSticker;
  return { mediaAny, hasImage, hasGif, hasSticker };
}

function extractTokens(content, useStopwords) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return [];
  const matches = text.match(WORD_TOKEN_REGEX) || [];
  const tokens = [];
  for (const match of matches) {
    const token = String(match || '').toLowerCase();
    if (!token) continue;
    if (useStopwords && STOPWORDS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function getMessageTimestamp(message) {
  if (Number.isFinite(message?.createdTimestamp)) return message.createdTimestamp;
  const parsed = Date.parse(message?.createdAt || message?.timestamp || '');
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

function getMessageId(message) {
  if (!message) return null;
  const id = String(message.id || '').trim();
  return id || null;
}

function buildUserLabel(author, userId) {
  const base = String(
    author?.globalName
      || author?.username
      || author?.tag
      || userId
      || 'Unknown',
  ).trim();
  const safeBase = base || 'Unknown';
  return `${safeBase} [${userId}]`;
}

function makeCheckpointIdentity({ guildId, channelId, startUtcMs, endUtcMs, includeBots }) {
  const startIso = startUtcMs !== null && startUtcMs !== undefined ? new Date(startUtcMs).toISOString() : null;
  const endIso = endUtcMs !== null && endUtcMs !== undefined ? new Date(endUtcMs).toISOString() : null;

  const startPart = sanitizeFilePart(startIso ? startIso.replace(/[:.]/g, '-') : 'none');
  const endPart = sanitizeFilePart(endIso ? endIso.replace(/[:.]/g, '-') : 'none');
  const botsPart = includeBots ? 'bots' : 'nobots';
  const rawKey = `${guildId}:${channelId}:${startIso || 'none'}:${endIso || 'none'}:${botsPart}`;
  const hash = crypto.createHash('sha1').update(rawKey).digest('hex').slice(0, 12);
  const fileName = `checkpoint_${channelId}_${startPart}_${endPart}_${botsPart}_${hash}.json`;

  return {
    key: rawKey,
    hash,
    fileName,
    startIso,
    endIso,
  };
}

function createEmptyState(identity, context) {
  const nowIso = new Date().toISOString();
  return {
    version: 1,
    checkpoint_key: identity.key,
    checkpoint_file: identity.fileName,
    settings: {
      guild_id: context.guildId,
      channel_id: context.channelId,
      include_bots: context.includeBots,
      start_utc: identity.startIso,
      end_utc: identity.endIso,
    },
    started_at_utc: nowIso,
    last_updated_utc: nowIso,
    cursor_before_id: null,
    resume_from_message_number: 1,
    completed: false,
    completed_utc: null,
    totals: {
      fetched_messages: 0,
      scanned_messages: 0,
      text_only: 0,
      media_any: 0,
      image: 0,
      gif: 0,
      sticker: 0,
      total_words: 0,
      unique_words: 0,
      skipped_bots: 0,
      skipped_newer_than_end: 0,
      skipped_older_than_start: 0,
      duplicate_messages_ignored: 0,
    },
    users: {},
    words_overall: {},
    word_top_user: {},
    dedupe_recent_ids: [],
  };
}

function normalizeTotals(rawTotals) {
  const source = rawTotals && typeof rawTotals === 'object' ? rawTotals : {};
  const readInt = (key) => {
    const value = Number(source[key]);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  };
  return {
    fetched_messages: readInt('fetched_messages'),
    scanned_messages: readInt('scanned_messages'),
    text_only: readInt('text_only'),
    media_any: readInt('media_any'),
    image: readInt('image'),
    gif: readInt('gif'),
    sticker: readInt('sticker'),
    total_words: readInt('total_words'),
    unique_words: readInt('unique_words'),
    skipped_bots: readInt('skipped_bots'),
    skipped_newer_than_end: readInt('skipped_newer_than_end'),
    skipped_older_than_start: readInt('skipped_older_than_start'),
    duplicate_messages_ignored: readInt('duplicate_messages_ignored'),
  };
}

function normalizeUserEntry(rawUser, userId) {
  const source = rawUser && typeof rawUser === 'object' ? rawUser : {};
  const wordsSource = source.words && typeof source.words === 'object' && !Array.isArray(source.words)
    ? source.words
    : {};

  const words = {};
  for (const [word, rawCount] of Object.entries(wordsSource)) {
    const key = String(word || '').trim().toLowerCase();
    if (!key) continue;
    const count = Math.floor(Number(rawCount) || 0);
    if (count <= 0) continue;
    words[key] = count;
  }

  const toInt = (value) => {
    const parsed = Math.floor(Number(value) || 0);
    return parsed > 0 ? parsed : 0;
  };

  const resolvedUserId = String(source.user_id || userId || '').trim();
  return {
    user_id: resolvedUserId || userId,
    user_label: String(source.user_label || `${userId} [${userId}]`),
    message_count: toInt(source.message_count),
    text_only: toInt(source.text_only),
    media_any: toInt(source.media_any),
    image: toInt(source.image),
    gif: toInt(source.gif),
    sticker: toInt(source.sticker),
    total_words: toInt(source.total_words),
    words,
  };
}

function normalizeWordMap(rawWordMap) {
  const source = rawWordMap && typeof rawWordMap === 'object' && !Array.isArray(rawWordMap)
    ? rawWordMap
    : {};
  const words = {};
  for (const [word, rawCount] of Object.entries(source)) {
    const key = String(word || '').trim().toLowerCase();
    if (!key) continue;
    const count = Math.floor(Number(rawCount) || 0);
    if (count <= 0) continue;
    words[key] = count;
  }
  return words;
}

function normalizeWordTopUser(rawTop) {
  const source = rawTop && typeof rawTop === 'object' && !Array.isArray(rawTop) ? rawTop : {};
  const output = {};
  for (const [word, value] of Object.entries(source)) {
    const key = String(word || '').trim().toLowerCase();
    if (!key) continue;
    if (!value || typeof value !== 'object') continue;
    const userId = String(value.user_id || '').trim();
    const userLabel = String(value.user_label || '').trim();
    const count = Math.floor(Number(value.count) || 0);
    if (!userId || !userLabel || count <= 0) continue;
    output[key] = { user_id: userId, user_label: userLabel, count };
  }
  return output;
}

function normalizeState(rawState, identity, context, runtime) {
  const base = createEmptyState(identity, context);
  const source = rawState && typeof rawState === 'object' ? rawState : {};

  base.started_at_utc = String(source.started_at_utc || base.started_at_utc);
  base.last_updated_utc = String(source.last_updated_utc || base.last_updated_utc);
  base.cursor_before_id = source.cursor_before_id ? String(source.cursor_before_id) : null;
  base.resume_from_message_number = Math.max(
    1,
    Math.floor(Number(source.resume_from_message_number) || (base.totals.scanned_messages + 1)),
  );
  base.completed = Boolean(source.completed);
  base.completed_utc = source.completed_utc ? String(source.completed_utc) : null;
  base.totals = normalizeTotals(source.totals);
  base.words_overall = normalizeWordMap(source.words_overall);
  base.word_top_user = normalizeWordTopUser(source.word_top_user);

  const usersSource = source.users && typeof source.users === 'object' && !Array.isArray(source.users)
    ? source.users
    : {};
  base.users = {};
  for (const [userId, rawUser] of Object.entries(usersSource)) {
    const normalized = normalizeUserEntry(rawUser, userId);
    if (!normalized.user_id) continue;
    base.users[normalized.user_id] = normalized;
  }

  const dedupeIds = Array.isArray(source.dedupe_recent_ids)
    ? source.dedupe_recent_ids.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  base.dedupe_recent_ids = dedupeIds.slice(-runtime.dedupeWindow);
  base._dedupeLookup = new Set(base.dedupe_recent_ids);
  return base;
}

async function ensureOutputAndLogDirs(outputDir, logDir) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.mkdir(logDir, { recursive: true });
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

async function appendScanLog(logPath, level, message) {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${message}\n`;
  await fs.promises.appendFile(logPath, line, 'utf8');

  if (level === 'ERROR') console.error(line.trim());
  else if (level === 'WARN') console.warn(line.trim());
  else console.log(line.trim());
}

function markMessageSeen(state, messageId, dedupeWindow) {
  if (!messageId) return true;
  if (!state._dedupeLookup) {
    state._dedupeLookup = new Set(Array.isArray(state.dedupe_recent_ids) ? state.dedupe_recent_ids : []);
  }

  if (state._dedupeLookup.has(messageId)) {
    return false;
  }

  state._dedupeLookup.add(messageId);
  if (!Array.isArray(state.dedupe_recent_ids)) state.dedupe_recent_ids = [];
  state.dedupe_recent_ids.push(messageId);

  if (state.dedupe_recent_ids.length > dedupeWindow) {
    const overflow = state.dedupe_recent_ids.length - dedupeWindow;
    const removed = state.dedupe_recent_ids.splice(0, overflow);
    for (const oldId of removed) {
      state._dedupeLookup.delete(oldId);
    }
  }

  return true;
}

function getOrCreateUser(state, userId, author) {
  if (!state.users[userId] || typeof state.users[userId] !== 'object') {
    state.users[userId] = {
      user_id: userId,
      user_label: buildUserLabel(author, userId),
      message_count: 0,
      text_only: 0,
      media_any: 0,
      image: 0,
      gif: 0,
      sticker: 0,
      total_words: 0,
      words: {},
    };
  }

  const user = state.users[userId];
  user.user_label = buildUserLabel(author, userId);
  if (!user.words || typeof user.words !== 'object' || Array.isArray(user.words)) {
    user.words = {};
  }
  return user;
}

function incrementWordForUser(state, user, word) {
  const previousUserCount = Math.floor(Number(user.words[word]) || 0);
  const nextUserCount = previousUserCount + 1;
  user.words[word] = nextUserCount;
  user.total_words += 1;

  const previousOverall = Math.floor(Number(state.words_overall[word]) || 0);
  if (previousOverall <= 0) {
    state.totals.unique_words += 1;
  }
  state.words_overall[word] = previousOverall + 1;
  state.totals.total_words += 1;

  const currentTop = state.word_top_user[word];
  const shouldReplace = !currentTop
    || nextUserCount > currentTop.count
    || (nextUserCount === currentTop.count && String(user.user_id).localeCompare(String(currentTop.user_id)) < 0);

  if (shouldReplace) {
    state.word_top_user[word] = {
      user_id: user.user_id,
      user_label: user.user_label,
      count: nextUserCount,
    };
  } else if (currentTop && currentTop.user_id === user.user_id) {
    currentTop.count = nextUserCount;
    currentTop.user_label = user.user_label;
  }
}

function processMessageIntoState(state, message, runtime) {
  const userId = String(message?.author?.id || '').trim();
  if (!userId) return;

  const user = getOrCreateUser(state, userId, message.author);
  const media = classifyMessageMedia(message);

  state.totals.scanned_messages += 1;
  user.message_count += 1;

  if (media.mediaAny) {
    state.totals.media_any += 1;
    user.media_any += 1;
    if (media.hasImage) {
      state.totals.image += 1;
      user.image += 1;
    }
    if (media.hasGif) {
      state.totals.gif += 1;
      user.gif += 1;
    }
    if (media.hasSticker) {
      state.totals.sticker += 1;
      user.sticker += 1;
    }
    return;
  }

  state.totals.text_only += 1;
  user.text_only += 1;

  const tokens = extractTokens(message?.content || '', runtime.useStopwords);
  for (const token of tokens) {
    incrementWordForUser(state, user, token);
  }
}

function sortedWordEntries(wordMap, limit) {
  return Object.entries(wordMap || {})
    .map(([word, rawCount]) => ({ word, count: Math.floor(Number(rawCount) || 0) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.word.localeCompare(b.word);
    })
    .slice(0, Math.max(1, Math.floor(limit)));
}

function sortedUsersByMessageCount(users) {
  return Object.values(users || {})
    .sort((a, b) => {
      if (b.message_count !== a.message_count) return b.message_count - a.message_count;
      return String(a.user_id).localeCompare(String(b.user_id));
    });
}

function buildFinalPayload({ state, runtime, identity, guild, channel, checkpointPath, durationMs }) {
  const topWords = sortedWordEntries(state.words_overall, runtime.topWordsLimit).map((entry) => {
    const top = state.word_top_user[entry.word];
    return {
      word: entry.word,
      count: entry.count,
      top_user: top
        ? { user: top.user_label, user_id: top.user_id, count: top.count }
        : null,
    };
  });

  const sortedUsers = sortedUsersByMessageCount(state.users);
  const users = {};
  for (const user of sortedUsers) {
    users[user.user_id] = {
      user: user.user_label,
      user_id: user.user_id,
      message_count: user.message_count,
      text_only: user.text_only,
      media_any: user.media_any,
      image: user.image,
      gif: user.gif,
      sticker: user.sticker,
      total_words: user.total_words,
      unique_words: Object.keys(user.words || {}).length,
      top_words: sortedWordEntries(user.words, runtime.userTopWordsLimit),
    };
  }

  return {
    exported_at: new Date().toISOString(),
    guild: {
      id: String(guild?.id || ''),
      name: String(guild?.name || ''),
    },
    channel: {
      id: String(channel?.id || ''),
      name: String(channel?.name || ''),
    },
    settings: {
      fast_mode: runtime.fastMode,
      request_delay_seconds: runtime.requestDelaySeconds,
      request_page_size: runtime.pageSize,
      progress_every_messages: runtime.progressEveryMessages,
      checkpoint_every_messages: runtime.checkpointEveryMessages,
      progress_every_ms: runtime.progressEveryMs,
      checkpoint_every_ms: runtime.checkpointEveryMs,
      use_stopwords: runtime.useStopwords,
      top_words_limit: runtime.topWordsLimit,
      user_top_words_limit: runtime.userTopWordsLimit,
      include_bots: state.settings.include_bots,
      start_utc: state.settings.start_utc,
      end_utc: state.settings.end_utc,
    },
    checkpoint: {
      file: path.basename(checkpointPath),
      cursor_before_id: state.cursor_before_id || null,
      resume_from_message_number: state.resume_from_message_number,
      completed: state.completed,
      completed_utc: state.completed_utc,
      last_updated_utc: state.last_updated_utc,
    },
    totals: {
      fetched_messages: state.totals.fetched_messages,
      scanned_messages: state.totals.scanned_messages,
      text_only: state.totals.text_only,
      media_any: state.totals.media_any,
      image: state.totals.image,
      gif: state.totals.gif,
      sticker: state.totals.sticker,
      total_words: state.totals.total_words,
      unique_words: state.totals.unique_words,
      duplicate_messages_ignored: state.totals.duplicate_messages_ignored,
      skipped_bots: state.totals.skipped_bots,
      skipped_newer_than_end: state.totals.skipped_newer_than_end,
      skipped_older_than_start: state.totals.skipped_older_than_start,
      elapsed_seconds: Number((Math.max(0, durationMs) / 1000).toFixed(2)),
      messages_per_second: durationMs > 0
        ? Number(((state.totals.scanned_messages * 1000) / durationMs).toFixed(2))
        : 0,
    },
    per_user_message_counts: sortedUsers.map((user) => ({
      user: user.user_label,
      user_id: user.user_id,
      count: user.message_count,
    })),
    users,
    words: {
      total_words: state.totals.total_words,
      unique_words: state.totals.unique_words,
      top: topWords,
    },
    range_key: identity.key,
  };
}

function buildProgressSnapshot({ state, startedAtMs, resumedFromCount, runtime, checkpointPath }) {
  const elapsedMs = Math.max(1, Date.now() - startedAtMs);
  const sessionScanned = Math.max(0, state.totals.scanned_messages - resumedFromCount);
  return {
    scanned_messages: state.totals.scanned_messages,
    rate_messages_per_second: Number(((sessionScanned * 1000) / elapsedMs).toFixed(2)),
    text_only: state.totals.text_only,
    media_any: state.totals.media_any,
    image: state.totals.image,
    gif: state.totals.gif,
    sticker: state.totals.sticker,
    total_words: state.totals.total_words,
    unique_words: state.totals.unique_words,
    duplicate_messages_ignored: state.totals.duplicate_messages_ignored,
    cursor_before_id: state.cursor_before_id || null,
    resume_from_message_number: state.resume_from_message_number,
    checkpoint_file: path.basename(checkpointPath),
    fast_mode: runtime.fastMode,
    request_delay_seconds: runtime.requestDelaySeconds,
  };
}

async function saveCheckpoint(state, checkpointPath) {
  state.last_updated_utc = new Date().toISOString();
  const payload = { ...state };
  delete payload._dedupeLookup;
  await writeJsonAtomic(checkpointPath, payload);
}

async function fetchMessagePage(channel, beforeId, limit) {
  const args = { limit };
  if (beforeId) args.before = beforeId;

  let attempt = 0;
  while (attempt < 4) {
    attempt += 1;
    try {
      return await channel.messages.fetch(args);
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(attempt * 600);
    }
  }
  return channel.messages.fetch(args);
}

function sortMessagesNewestToOldest(collection) {
  return Array.from(collection.values()).sort((a, b) => {
    const aId = BigInt(String(a.id || '0'));
    const bId = BigInt(String(b.id || '0'));
    if (aId === bId) return 0;
    return aId > bId ? -1 : 1;
  });
}

async function scanChannelAll(options) {
  const {
    guild,
    channel,
    startUtcInput = null,
    endUtcInput = null,
    includeBots = false,
    resume = true,
    onProgress = null,
  } = options || {};

  if (!guild?.id || !channel?.id || !channel?.messages?.fetch) {
    throw new Error('A valid guild text channel is required.');
  }

  const startUtcMs = parseUtcInput(startUtcInput, 'start', 'start_utc');
  const endUtcMs = parseUtcInput(endUtcInput, 'end', 'end_utc');
  if (startUtcMs !== null && endUtcMs !== null && startUtcMs > endUtcMs) {
    throw new Error('start_utc must be less than or equal to end_utc.');
  }

  const runtime = resolveRuntimeSettings();

  const outputDir = path.join(process.cwd(), 'output');
  const logDir = path.join(process.cwd(), 'logs');
  await ensureOutputAndLogDirs(outputDir, logDir);

  const logPath = path.join(logDir, 'scan_bot.log');
  const identity = makeCheckpointIdentity({
    guildId: guild.id,
    channelId: channel.id,
    startUtcMs,
    endUtcMs,
    includeBots: Boolean(includeBots),
  });
  const checkpointPath = path.join(outputDir, identity.fileName);

  if (ACTIVE_SCAN_KEYS.has(identity.key)) {
    throw new Error('A scan for this channel/range is already running.');
  }
  ACTIVE_SCAN_KEYS.add(identity.key);

  let state = null;
  let resumed = false;

  try {
    const existingCheckpoint = await readJsonFile(checkpointPath);
    if (resume && existingCheckpoint) {
      state = normalizeState(existingCheckpoint, identity, {
        guildId: guild.id,
        channelId: channel.id,
        includeBots: Boolean(includeBots),
      }, runtime);
      resumed = true;
    } else {
      state = createEmptyState(identity, {
        guildId: guild.id,
        channelId: channel.id,
        includeBots: Boolean(includeBots),
      });
      state._dedupeLookup = new Set();
      resumed = false;
      await saveCheckpoint(state, checkpointPath);
    }

    if (!state._dedupeLookup) {
      state._dedupeLookup = new Set(Array.isArray(state.dedupe_recent_ids) ? state.dedupe_recent_ids : []);
    }

    if (state.completed) {
      await appendScanLog(
        logPath,
        'INFO',
        `Resume skipped: checkpoint already completed (${identity.fileName})`,
      );
      return {
        resumed,
        alreadyCompleted: true,
        checkpointPath,
        outputPath: null,
        runtime,
        state,
      };
    }

    await appendScanLog(
      logPath,
      'INFO',
      `${resumed ? 'Resuming' : 'Starting'} scan guild=${guild.id} channel=${channel.id} range=${identity.key}`,
    );

    const startedAtMs = Date.now();
    const resumedFromCount = state.totals.scanned_messages;
    let lastProgressAt = Date.now();
    let lastCheckpointAt = Date.now();
    let lastProgressCount = state.totals.scanned_messages;
    let lastCheckpointCount = state.totals.scanned_messages;
    let beforeId = state.cursor_before_id || null;
    let shouldStop = false;

    const maybeReportProgress = async (force = false) => {
      if (typeof onProgress !== 'function') return;
      const now = Date.now();
      const countDelta = state.totals.scanned_messages - lastProgressCount;
      const timeDelta = now - lastProgressAt;
      if (!force && countDelta < runtime.progressEveryMessages && timeDelta < runtime.progressEveryMs) return;
      lastProgressAt = now;
      lastProgressCount = state.totals.scanned_messages;
      const snapshot = buildProgressSnapshot({
        state,
        startedAtMs,
        resumedFromCount,
        runtime,
        checkpointPath,
      });
      await onProgress(snapshot);
    };

    const maybeCheckpoint = async (force = false) => {
      const now = Date.now();
      const countDelta = state.totals.scanned_messages - lastCheckpointCount;
      const timeDelta = now - lastCheckpointAt;
      if (!force && countDelta < runtime.checkpointEveryMessages && timeDelta < runtime.checkpointEveryMs) return;
      lastCheckpointAt = now;
      lastCheckpointCount = state.totals.scanned_messages;
      await saveCheckpoint(state, checkpointPath);
      await appendScanLog(
        logPath,
        'INFO',
        `Checkpoint updated ${identity.fileName} scanned=${formatNumber(state.totals.scanned_messages)} cursor=${state.cursor_before_id || 'none'}`,
      );
    };

    while (!shouldStop) {
      const page = await fetchMessagePage(channel, beforeId, runtime.pageSize);
      const messages = sortMessagesNewestToOldest(page);

      if (!messages.length) {
        state.completed = true;
        state.completed_utc = new Date().toISOString();
        break;
      }

      state.totals.fetched_messages += messages.length;
      let oldestIdInPage = null;

      for (const message of messages) {
        const messageId = getMessageId(message);
        if (messageId) oldestIdInPage = messageId;

        if (messageId && !markMessageSeen(state, messageId, runtime.dedupeWindow)) {
          state.totals.duplicate_messages_ignored += 1;
          continue;
        }

        const timestamp = getMessageTimestamp(message);
        if (endUtcMs !== null && timestamp !== null && timestamp > endUtcMs) {
          state.totals.skipped_newer_than_end += 1;
          continue;
        }

        if (startUtcMs !== null && timestamp !== null && timestamp < startUtcMs) {
          state.totals.skipped_older_than_start += 1;
          shouldStop = true;
          break;
        }

        if (!includeBots && message?.author?.bot) {
          state.totals.skipped_bots += 1;
          continue;
        }

        processMessageIntoState(state, message, runtime);
      }

      if (oldestIdInPage) {
        state.cursor_before_id = oldestIdInPage;
        state.resume_from_message_number = state.totals.scanned_messages + 1;
      }

      await maybeReportProgress(false);
      await maybeCheckpoint(false);

      if (shouldStop) {
        state.completed = true;
        state.completed_utc = new Date().toISOString();
        break;
      }

      beforeId = state.cursor_before_id;
      if (runtime.requestDelayMs > 0) {
        await sleep(runtime.requestDelayMs);
      }
    }

    state.last_updated_utc = new Date().toISOString();
    if (state.completed && !state.completed_utc) {
      state.completed_utc = state.last_updated_utc;
    }
    await saveCheckpoint(state, checkpointPath);
    await maybeReportProgress(true);

    const durationMs = Date.now() - startedAtMs;
    const finalPayload = buildFinalPayload({
      state,
      runtime,
      identity,
      guild,
      channel,
      checkpointPath,
      durationMs,
    });

    const outputFileName = `scan_ALL_${sanitizeFilePart(guild.name)}_${sanitizeFilePart(channel.name)}_${channel.id}_${utcTimestampForFile()}.json`;
    const outputPath = path.join(outputDir, outputFileName);
    await writeJsonAtomic(outputPath, finalPayload);

    await appendScanLog(
      logPath,
      'INFO',
      `Scan complete channel=${channel.id} scanned=${formatNumber(state.totals.scanned_messages)} output=${outputFileName}`,
    );

    return {
      resumed,
      alreadyCompleted: false,
      checkpointPath,
      outputPath,
      runtime,
      state,
    };
  } catch (err) {
    try {
      if (state) await saveCheckpoint(state, checkpointPath);
    } catch (_) {}
    try {
      await appendScanLog(logPath, 'ERROR', `Scan failed: ${err?.message || String(err)}`);
    } catch (_) {}
    throw err;
  } finally {
    ACTIVE_SCAN_KEYS.delete(identity.key);
  }
}

async function getResumeStatus(options) {
  const {
    guildId,
    channelId,
    startUtcInput = null,
    endUtcInput = null,
    includeBots = false,
  } = options || {};

  if (!guildId || !channelId) {
    throw new Error('guildId and channelId are required.');
  }

  const startUtcMs = parseUtcInput(startUtcInput, 'start', 'start_utc');
  const endUtcMs = parseUtcInput(endUtcInput, 'end', 'end_utc');
  if (startUtcMs !== null && endUtcMs !== null && startUtcMs > endUtcMs) {
    throw new Error('start_utc must be less than or equal to end_utc.');
  }

  const runtime = resolveRuntimeSettings();
  const outputDir = path.join(process.cwd(), 'output');
  const identity = makeCheckpointIdentity({
    guildId,
    channelId,
    startUtcMs,
    endUtcMs,
    includeBots: Boolean(includeBots),
  });
  const checkpointPath = path.join(outputDir, identity.fileName);
  const raw = await readJsonFile(checkpointPath);
  if (!raw) {
    return {
      found: false,
      checkpointPath,
      checkpointFile: identity.fileName,
      identity,
      state: null,
    };
  }

  const state = normalizeState(raw, identity, {
    guildId,
    channelId,
    includeBots: Boolean(includeBots),
  }, runtime);

  return {
    found: true,
    checkpointPath,
    checkpointFile: identity.fileName,
    identity,
    state,
  };
}

module.exports = {
  scanChannelAll,
  getResumeStatus,
  parseUtcInput,
};
