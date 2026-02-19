const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'autorespond.json';

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;

function ensureLoaded() {
  if (cache) return;
  try {
    ensureFileSync(STORE_FILE, '{}');
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    cache = raw ? JSON.parse(raw) : {};
    if (!cache || typeof cache !== 'object') cache = {};
  } catch (err) {
    console.error('Failed to load autorespond store:', err);
    cache = {};
  }
}

function persist() {
  const safe = cache && typeof cache === 'object' ? cache : {};
  writeJsonSync(STORE_FILE, safe);
}

function getGuildConfig(guildId) {
  ensureLoaded();
  if (!cache[guildId]) {
    cache[guildId] = { enabled: false, nextId: 1, rules: [] };
    persist();
  }
  const cfg = cache[guildId];
  let changed = false;
  if (typeof cfg.enabled !== 'boolean') cfg.enabled = false;
  if (!Array.isArray(cfg.rules)) cfg.rules = [];
  if (!cfg.nextId || typeof cfg.nextId !== 'number') cfg.nextId = 1;
  for (const rule of cfg.rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (typeof rule.stickerId !== 'string') {
      rule.stickerId = '';
      changed = true;
    }
    if (!Number.isFinite(rule.createdAt) || Number(rule.createdAt) <= 0) {
      rule.createdAt = Date.now();
      changed = true;
    }
  }
  if (changed) persist();
  return cfg;
}

function setEnabled(guildId, enabled) {
  const cfg = getGuildConfig(guildId);
  cfg.enabled = !!enabled;
  persist();
  return cfg.enabled;
}

function listRules(guildId) {
  const cfg = getGuildConfig(guildId);
  return cfg.rules.slice();
}

function addRule(guildId, rule) {
  const cfg = getGuildConfig(guildId);
  const id = cfg.nextId++;
  const cleaned = {
    id,
    trigger: String(rule.trigger || '').slice(0, 300),
    reply: String(rule.reply || '').slice(0, 2000),
    mediaUrl: String(rule.mediaUrl || '').slice(0, 1000),
    stickerId: String(rule.stickerId || '').trim().slice(0, 64),
    match: (rule.match || 'contains'),
    caseSensitive: !!rule.caseSensitive,
    channelId: rule.channelId || null,
    createdAt: Date.now(),
  };
  cfg.rules.push(cleaned);
  persist();
  return cleaned;
}

function getRule(guildId, id) {
  const cfg = getGuildConfig(guildId);
  return cfg.rules.find(r => r.id === Number(id)) || null;
}

function updateRule(guildId, id, updates = {}) {
  const cfg = getGuildConfig(guildId);
  const rule = cfg.rules.find(r => r.id === Number(id));
  if (!rule) return null;

  if (Object.prototype.hasOwnProperty.call(updates, 'trigger')) {
    rule.trigger = String(updates.trigger || '').slice(0, 300);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'reply')) {
    rule.reply = String(updates.reply || '').slice(0, 2000);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'mediaUrl')) {
    rule.mediaUrl = String(updates.mediaUrl || '').slice(0, 1000);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'stickerId')) {
    rule.stickerId = String(updates.stickerId || '').trim().slice(0, 64);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'match')) {
    rule.match = String(updates.match || 'contains');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'caseSensitive')) {
    rule.caseSensitive = !!updates.caseSensitive;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'channelId')) {
    rule.channelId = updates.channelId || null;
  }

  persist();
  return rule;
}

function removeRule(guildId, id) {
  const cfg = getGuildConfig(guildId);
  const before = cfg.rules.length;
  cfg.rules = cfg.rules.filter(r => r.id !== Number(id));
  const removed = cfg.rules.length !== before;
  if (removed) persist();
  return removed;
}

module.exports = {
  getGuildConfig,
  setEnabled,
  listRules,
  getRule,
  addRule,
  updateRule,
  removeRule,
};
