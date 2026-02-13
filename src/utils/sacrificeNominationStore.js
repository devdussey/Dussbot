const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'sacrifice_nominations.json';
const DEFAULT_STORE = { guilds: {} };
const MAX_USES = 2;
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
    store.guilds[guildId] = { users: {} };
  } else if (!store.guilds[guildId].users || typeof store.guilds[guildId].users !== 'object') {
    store.guilds[guildId].users = {};
  }
  return store.guilds[guildId];
}

function parseResetAtMs(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function normalizeRecord(rec, now = Date.now()) {
  if (!rec || typeof rec !== 'object') {
    return { uses: 0, resetAt: null, changed: true };
  }

  let changed = false;
  let uses = Number.isFinite(rec.uses) ? Math.floor(rec.uses) : 0;
  if (uses < 0) {
    uses = 0;
    changed = true;
  }
  if (uses > MAX_USES) {
    uses = MAX_USES;
    changed = true;
  }

  let resetAtMs = parseResetAtMs(rec.resetAt);
  if (uses < MAX_USES) {
    if (rec.resetAt !== null) changed = true;
    resetAtMs = null;
  } else {
    if (!Number.isFinite(resetAtMs)) {
      resetAtMs = now + REGEN_MS;
      changed = true;
    } else if (now >= resetAtMs) {
      uses = 0;
      resetAtMs = null;
      changed = true;
    }
  }

  return {
    uses,
    resetAt: resetAtMs ? new Date(resetAtMs).toISOString() : null,
    changed,
  };
}

function getRecord(guildId, userId, now = Date.now()) {
  const guild = ensureGuild(guildId);
  const existing = guild.users[userId];
  const normalized = normalizeRecord(existing, now);
  if (
    !existing ||
    normalized.changed ||
    existing.uses !== normalized.uses ||
    existing.resetAt !== normalized.resetAt
  ) {
    guild.users[userId] = { uses: normalized.uses, resetAt: normalized.resetAt };
    normalized.changed = true;
  } else {
    normalized.changed = false;
  }
  return normalized;
}

async function consumeNomination(guildId, userId, now = Date.now()) {
  if (!guildId || !userId) return { allowed: false, remaining: 0, usesToday: MAX_USES, retryAfterMs: REGEN_MS };
  const rec = getRecord(guildId, userId, now);

  if (rec.uses >= MAX_USES) {
    if (rec.changed) await saveStore();
    const resetAtMs = parseResetAtMs(rec.resetAt);
    const retryAfterMs = resetAtMs ? Math.max(0, resetAtMs - now) : REGEN_MS;
    return {
      allowed: false,
      remaining: 0,
      usesToday: MAX_USES,
      resetAt: rec.resetAt,
      retryAfterMs,
    };
  }

  const nextUses = rec.uses + 1;
  const nextResetAt = nextUses >= MAX_USES ? new Date(now + REGEN_MS).toISOString() : null;

  const guild = ensureGuild(guildId);
  guild.users[userId] = { uses: nextUses, resetAt: nextResetAt };
  await saveStore();

  return {
    allowed: true,
    usesToday: nextUses,
    remaining: Math.max(0, MAX_USES - nextUses),
    resetAt: nextResetAt,
    retryAfterMs: nextResetAt ? Math.max(0, Date.parse(nextResetAt) - now) : 0,
  };
}

async function rollbackLastNomination(guildId, userId) {
  if (!guildId || !userId) return;
  const guild = ensureGuild(guildId);
  const rec = getRecord(guildId, userId);
  if (rec.uses <= 0) return;

  const nextUses = Math.max(0, rec.uses - 1);
  const nextResetAt = nextUses >= MAX_USES ? rec.resetAt : null;
  guild.users[userId] = { uses: nextUses, resetAt: nextResetAt };
  await saveStore();
}

module.exports = {
  consumeNomination,
  rollbackLastNomination,
};
