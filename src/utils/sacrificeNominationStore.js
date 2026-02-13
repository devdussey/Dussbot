const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'sacrifice_nominations.json';
const DEFAULT_STORE = { guilds: {} };
const REGEN_MS = 24 * 60 * 60 * 1000;

let cache = null;

function getStorePath() {
  return resolveDataPath(STORE_FILE);
}

function loadStore() {
  if (cache) return cache;
  try {
    ensureFileSync(STORE_FILE, DEFAULT_STORE);
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') {
      cache = { ...DEFAULT_STORE };
    } else {
      cache = { ...DEFAULT_STORE, ...parsed };
      if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
    }
  } catch (err) {
    console.error('Failed to load sacrifice nomination store:', err);
    cache = { ...DEFAULT_STORE };
  }
  return cache;
}

async function saveStore() {
  const safe = cache && typeof cache === 'object' ? cache : { ...DEFAULT_STORE };
  if (!safe.guilds || typeof safe.guilds !== 'object') safe.guilds = {};
  try {
    await writeJson(STORE_FILE, safe);
  } catch (err) {
    console.error('Failed to save sacrifice nomination store:', err);
  }
}

function ensureGuild(guildId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = { users: {}, targets: {} };
  }
  const guild = store.guilds[guildId];
  if (!guild.users || typeof guild.users !== 'object') guild.users = {};
  if (!guild.targets || typeof guild.targets !== 'object') guild.targets = {};
  return guild;
}

function parseIsoMs(value) {
  if (!value || typeof value !== 'string') return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function normalizeUserRecord(rec) {
  if (!rec || typeof rec !== 'object') return { lastNominationAt: null };

  // Backward compatibility with older format ({ uses, resetAt }).
  if (Object.prototype.hasOwnProperty.call(rec, 'uses') || Object.prototype.hasOwnProperty.call(rec, 'resetAt')) {
    const resetAtMs = parseIsoMs(rec.resetAt);
    const uses = Number.isFinite(rec.uses) ? Math.floor(rec.uses) : 0;
    if (uses >= 1 && Number.isFinite(resetAtMs)) {
      return { lastNominationAt: new Date(Math.max(0, resetAtMs - REGEN_MS)).toISOString() };
    }
    return { lastNominationAt: null };
  }

  const lastNominationAtMs = parseIsoMs(rec.lastNominationAt);
  return { lastNominationAt: lastNominationAtMs ? new Date(lastNominationAtMs).toISOString() : null };
}

function normalizeTargetCount(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

async function consumeNomination(guildId, userId, targetId, now = Date.now()) {
  if (!guildId || !userId || !targetId) {
    return { allowed: false, retryAfterMs: REGEN_MS };
  }

  const guild = ensureGuild(guildId);

  const userRec = normalizeUserRecord(guild.users[userId]);
  const lastNominationAtMs = parseIsoMs(userRec.lastNominationAt);
  const nextAvailableAtMs = Number.isFinite(lastNominationAtMs) ? lastNominationAtMs + REGEN_MS : 0;
  if (Number.isFinite(nextAvailableAtMs) && nextAvailableAtMs > now) {
    return {
      allowed: false,
      retryAfterMs: nextAvailableAtMs - now,
      nextAvailableAt: new Date(nextAvailableAtMs).toISOString(),
    };
  }

  const previousLastNominationAt = userRec.lastNominationAt;
  const previousTargetCount = normalizeTargetCount(guild.targets[targetId]);

  const nextLastNominationAt = new Date(now).toISOString();
  const nextTargetCount = previousTargetCount + 1;
  guild.users[userId] = { lastNominationAt: nextLastNominationAt };
  guild.targets[targetId] = nextTargetCount;
  await saveStore();

  return {
    allowed: true,
    nextAvailableAt: new Date(now + REGEN_MS).toISOString(),
    retryAfterMs: REGEN_MS,
    targetNominationCount: nextTargetCount,
    rollbackToken: {
      userId,
      targetId,
      previousLastNominationAt,
      previousTargetCount,
    },
  };
}

async function rollbackLastNomination(guildId, rollbackToken) {
  if (!guildId || !rollbackToken || typeof rollbackToken !== 'object') return;
  const { userId, targetId, previousLastNominationAt, previousTargetCount } = rollbackToken;
  if (!userId || !targetId) return;

  const guild = ensureGuild(guildId);
  guild.users[userId] = { lastNominationAt: previousLastNominationAt || null };
  guild.targets[targetId] = normalizeTargetCount(previousTargetCount);
  await saveStore();
}

module.exports = {
  consumeNomination,
  rollbackLastNomination,
};
