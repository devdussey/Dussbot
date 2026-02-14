const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson, readJsonSync, writeJsonSync } = require('./dataDir');

const STORE_FILE_NAME = 'rupee_tokens.json';
const LEGACY_STORE_FILE_NAME = 'judgement_tokens.json';
const AWARD_THRESHOLD = 500;

let cache = null;

function getStoreFilePath() {
  return resolveDataPath(STORE_FILE_NAME);
}

function ensureStoreFile() {
  try {
    const target = getStoreFilePath();
    if (!fs.existsSync(target)) {
      const legacy = readJsonSync(LEGACY_STORE_FILE_NAME, undefined);
      if (legacy && typeof legacy === 'object') {
        try {
          writeJsonSync(STORE_FILE_NAME, legacy);
        } catch (err) {
          console.error('Failed to migrate legacy rupee token store', err);
        }
      }
    }
    ensureFileSync(STORE_FILE_NAME, { guilds: {} });
  } catch (err) {
    console.error('Failed to initialise rupee token store', err);
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

function normalizeThreshold(threshold) {
  const num = Number(threshold);
  if (!Number.isFinite(num)) return AWARD_THRESHOLD;
  const whole = Math.floor(num);
  return whole >= 1 ? whole : AWARD_THRESHOLD;
}

function ensureRecord(guildId, userId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = { users: {} };
  }
  const guild = store.guilds[guildId];
  if (!guild.users || typeof guild.users !== 'object') guild.users = {};
  if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
    guild.users[userId] = {
      totalMessages: 0,
      progress: 0,
      tokens: 0,
    };
  }
  const rec = guild.users[userId];
  if (!Number.isFinite(rec.totalMessages)) rec.totalMessages = 0;
  if (!Number.isFinite(rec.progress) || rec.progress < 0) rec.progress = 0;
  if (!Number.isFinite(rec.tokens) || rec.tokens < 0) rec.tokens = 0;
  rec.totalMessages = Math.floor(rec.totalMessages);
  rec.progress = Math.floor(rec.progress);
  rec.tokens = Math.floor(rec.tokens);
  return rec;
}

async function incrementMessage(guildId, userId, options = {}) {
  if (!guildId || !userId) return null;
  const awardThreshold = normalizeThreshold(options.awardThreshold);
  const rec = ensureRecord(guildId, userId);
  rec.totalMessages += 1;
  rec.progress += 1;
  let awarded = 0;
  while (rec.progress >= awardThreshold) {
    rec.progress -= awardThreshold;
    rec.tokens += 1;
    awarded += 1;
  }
  await saveStore();
  return {
    awarded,
    tokens: rec.tokens,
    totalMessages: rec.totalMessages,
    progress: rec.progress,
    messagesUntilNext: awardThreshold - rec.progress,
  };
}

async function consumeToken(guildId, userId) {
  if (!guildId || !userId) return false;
  const rec = ensureRecord(guildId, userId);
  if (rec.tokens <= 0) return false;
  rec.tokens -= 1;
  await saveStore();
  return true;
}

async function spendTokens(guildId, userId, amount = 1) {
  if (!guildId || !userId) return false;
  const num = Math.max(0, Math.floor(Number(amount) || 0));
  if (num === 0) return true;
  const rec = ensureRecord(guildId, userId);
  if (rec.tokens < num) return false;
  rec.tokens -= num;
  await saveStore();
  return true;
}

async function addTokens(guildId, userId, amount = 1) {
  if (!guildId || !userId) return 0;
  const num = Number(amount) || 0;
  if (num <= 0) return getBalance(guildId, userId);
  const rec = ensureRecord(guildId, userId);
  rec.tokens += num;
  await saveStore();
  return rec.tokens;
}

function getBalance(guildId, userId) {
  if (!guildId || !userId) return 0;
  const rec = ensureRecord(guildId, userId);
  return rec.tokens;
}

function getProgress(guildId, userId, options = {}) {
  const awardThreshold = normalizeThreshold(options.awardThreshold);
  if (!guildId || !userId) {
    return {
      totalMessages: 0,
      tokens: 0,
      progress: 0,
      messagesUntilNext: awardThreshold,
    };
  }
  const rec = ensureRecord(guildId, userId);
  return {
    totalMessages: rec.totalMessages,
    tokens: rec.tokens,
    progress: rec.progress,
    messagesUntilNext: awardThreshold - rec.progress,
  };
}

function listUserBalances(guildId, options = {}) {
  if (!guildId) return [];
  const minTokens = Number.isFinite(options.minTokens) ? options.minTokens : 1;
  const store = loadStore();
  const guild = store?.guilds?.[guildId];
  const users = guild?.users && typeof guild.users === 'object' ? guild.users : {};

  return Object.entries(users)
    .map(([userId, rec]) => {
      const tokens = Number.isFinite(rec?.tokens) ? Math.floor(rec.tokens) : 0;
      return { userId, tokens };
    })
    .filter(entry => entry.tokens >= minTokens)
    .sort((a, b) => (b.tokens - a.tokens) || String(a.userId).localeCompare(String(b.userId)));
}

module.exports = {
  AWARD_THRESHOLD,
  incrementMessage,
  consumeToken,
  spendTokens,
  addTokens,
  getBalance,
  getProgress,
  listUserBalances,
};
