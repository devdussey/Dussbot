const fs = require('fs/promises');
const { ensureFile, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'restrainingOrders.json';

function getFilePath() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;
let saveTimeout = null;

function normalizePair(a, b) {
  const first = String(a);
  const second = String(b);
  return first < second ? [first, second] : [second, first];
}

function makeKey(a, b) {
  const [first, second] = normalizePair(a, b);
  return `${first}:${second}`;
}

async function ensureStoreFile() {
  try {
    await ensureFile(STORE_FILE, { guilds: {} });
  } catch (err) {
    console.error('Failed to prepare restraining order store file:', err);
  }
}

async function load() {
  if (cache) return cache;
  await ensureStoreFile();
  try {
    const raw = await fs.readFile(getFilePath(), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
    cache = parsed;
  } catch (err) {
    console.error('Failed to load restraining order store:', err);
    cache = { guilds: {} };
  }
  return cache;
}

function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    try {
      const safe = cache && typeof cache === 'object' ? cache : { guilds: {} };
      if (!safe.guilds || typeof safe.guilds !== 'object') safe.guilds = {};
      await writeJson(STORE_FILE, safe);
    } catch (err) {
      console.error('Failed to save restraining order store:', err);
    }
  }, 100);
}

function getGuild(data, guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = { pairs: {} };
  if (!data.guilds[guildId].pairs || typeof data.guilds[guildId].pairs !== 'object') {
    data.guilds[guildId].pairs = {};
  }
  return data.guilds[guildId];
}

module.exports = {
  normalizePair,
  makeKey,
  async add(guildId, userA, userB, meta = {}) {
    const data = await load();
    const guild = getGuild(data, guildId);
    const key = makeKey(userA, userB);
    const [id1, id2] = normalizePair(userA, userB);
    const entry = {
      userIds: [id1, id2],
      users: [meta.userAName || null, meta.userBName || null],
      createdBy: meta.createdBy || null,
      createdAt: meta.createdAt || Date.now(),
    };
    const existed = Boolean(guild.pairs[key]);
    guild.pairs[key] = entry;
    scheduleSave();
    return { existed, entry };
  },
  async remove(guildId, userA, userB) {
    const data = await load();
    const guild = getGuild(data, guildId);
    const key = makeKey(userA, userB);
    const entry = guild.pairs[key] || null;
    delete guild.pairs[key];
    scheduleSave();
    return entry;
  },
  async get(guildId, userA, userB) {
    const data = await load();
    const guild = getGuild(data, guildId);
    const key = makeKey(userA, userB);
    return guild.pairs[key] || null;
  },
  async list(guildId) {
    const data = await load();
    const guild = getGuild(data, guildId);
    return Object.entries(guild.pairs).map(([key, info]) => ({ key, ...info }));
  },
};
