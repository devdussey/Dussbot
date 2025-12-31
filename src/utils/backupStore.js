const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'backups.json';

let cache = null;

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

function ensureLoaded() {
  if (cache) return;
  try {
    ensureFileSync(STORE_FILE, JSON.stringify({ guilds: {} }, null, 2));
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    cache = raw ? JSON.parse(raw) : { guilds: {} };
    if (!cache || typeof cache !== 'object') cache = { guilds: {} };
    if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
  } catch (err) {
    console.error('Failed to load backup store:', err);
    cache = { guilds: {} };
  }
}

function persist() {
  const safe = cache && typeof cache === 'object' ? cache : { guilds: {} };
  writeJsonSync(STORE_FILE, safe);
}

function ensureGuild(guildId) {
  ensureLoaded();
  const id = String(guildId);
  if (!cache.guilds[id]) {
    cache.guilds[id] = { nextId: 1, backups: {} };
  }
  const guild = cache.guilds[id];
  if (!Number.isInteger(guild.nextId) || guild.nextId < 1) guild.nextId = 1;
  if (!guild.backups || typeof guild.backups !== 'object') guild.backups = {};
  return guild;
}

function sanitizeBackup(backup) {
  if (!backup || typeof backup !== 'object') return null;
  const cleaned = {
    id: String(backup.id || '').trim(),
    guildId: backup.guildId ? String(backup.guildId) : null,
    guildName: backup.guildName ? String(backup.guildName) : null,
    createdAt: Number.isFinite(backup.createdAt) ? backup.createdAt : Date.now(),
    createdBy: backup.createdBy && typeof backup.createdBy === 'object'
      ? {
        id: backup.createdBy.id ? String(backup.createdBy.id) : null,
        tag: backup.createdBy.tag ? String(backup.createdBy.tag) : null,
      }
      : { id: null, tag: null },
    snapshot: backup.snapshot && typeof backup.snapshot === 'object' ? backup.snapshot : {},
    warnings: Array.isArray(backup.warnings) ? backup.warnings.map(w => String(w)) : [],
  };
  if (!cleaned.id || !cleaned.guildId) return null;
  return cleaned;
}

function createBackup(guildId, backup) {
  const guild = ensureGuild(guildId);
  const id = String(guild.nextId++);
  const stored = sanitizeBackup({
    id,
    guildId: String(guildId),
    guildName: backup?.guildName,
    createdAt: backup?.createdAt || Date.now(),
    createdBy: backup?.createdBy,
    snapshot: backup?.snapshot || {},
    warnings: backup?.warnings || [],
  });
  if (!stored) throw new Error('Invalid backup payload');
  guild.backups[id] = stored;
  persist();
  return stored;
}

function listBackups(guildId) {
  const guild = ensureGuild(guildId);
  return Object.values(guild.backups)
    .map(sanitizeBackup)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getBackup(guildId, backupId) {
  const guild = ensureGuild(guildId);
  const backup = guild.backups[String(backupId)];
  return sanitizeBackup(backup);
}

function removeBackup(guildId, backupId) {
  const guild = ensureGuild(guildId);
  const key = String(backupId);
  const backup = guild.backups[key];
  if (!backup) return null;
  delete guild.backups[key];
  persist();
  return sanitizeBackup(backup);
}

module.exports = {
  createBackup,
  listBackups,
  getBackup,
  removeBackup,
};
