const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE_NAME = 'vanity_roles.json';

let cache = null;

function getStoreFilePath() {
  return resolveDataPath(STORE_FILE_NAME);
}

function ensureStoreFile() {
  try {
    ensureFileSync(STORE_FILE_NAME, { guilds: {} });
  } catch (err) {
    console.error('Failed to initialise vanity role store', err);
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
  } catch {
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

function ensureUserRecord(guildId, userId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = { users: {} };
  }
  const guild = store.guilds[guildId];
  if (!guild.users || typeof guild.users !== 'object') guild.users = {};
  if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
    guild.users[userId] = {
      roleId: null,
      primary: null,
      secondary: null,
      active: 'primary',
      hoist: false,
    };
  }

  const rec = guild.users[userId];
  if (typeof rec.roleId !== 'string') rec.roleId = null;
  if (typeof rec.primary !== 'string') rec.primary = null;
  if (typeof rec.secondary !== 'string') rec.secondary = null;
  if (rec.active !== 'primary' && rec.active !== 'secondary') rec.active = 'primary';
  if (typeof rec.hoist !== 'boolean') rec.hoist = false;
  return rec;
}

function getUserRecord(guildId, userId) {
  if (!guildId || !userId) return null;
  const store = loadStore();
  const guild = store.guilds[guildId];
  const rec = guild?.users?.[userId];
  if (!rec || typeof rec !== 'object') return null;
  return ensureUserRecord(guildId, userId);
}

async function upsertUserRecord(guildId, userId, patch) {
  if (!guildId || !userId) return null;
  const rec = ensureUserRecord(guildId, userId);
  const safePatch = patch && typeof patch === 'object' ? patch : {};

  if ('roleId' in safePatch) rec.roleId = typeof safePatch.roleId === 'string' ? safePatch.roleId : null;
  if ('primary' in safePatch) rec.primary = typeof safePatch.primary === 'string' ? safePatch.primary : null;
  if ('secondary' in safePatch) rec.secondary = typeof safePatch.secondary === 'string' ? safePatch.secondary : null;
  if ('active' in safePatch) rec.active = safePatch.active === 'secondary' ? 'secondary' : 'primary';
  if ('hoist' in safePatch) rec.hoist = safePatch.hoist === true;

  await saveStore();
  return rec;
}

async function deleteUserRecord(guildId, userId) {
  if (!guildId || !userId) return false;
  const store = loadStore();
  const guild = store.guilds[guildId];
  if (!guild?.users || typeof guild.users !== 'object') return false;
  if (!guild.users[userId]) return false;
  delete guild.users[userId];
  await saveStore();
  return true;
}

module.exports = {
  getUserRecord,
  upsertUserRecord,
  deleteUserRecord,
};

