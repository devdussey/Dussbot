const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'reaction_roles.json';

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;

function ensureLoaded() {
  if (cache) return;
  try {
    ensureFileSync(STORE_FILE, JSON.stringify({ guilds: {} }, null, 2));
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    cache = raw ? JSON.parse(raw) : { guilds: {} };
    if (!cache || typeof cache !== 'object') cache = { guilds: {} };
    if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
  } catch (err) {
    console.error('Failed to load reaction role store:', err);
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
    cache.guilds[id] = { nextId: 1, panels: {} };
  }
  const guild = cache.guilds[id];
  if (!Number.isInteger(guild.nextId) || guild.nextId < 1) guild.nextId = 1;
  if (!guild.panels || typeof guild.panels !== 'object') guild.panels = {};
  return guild;
}

function sanitiseRoleIds(roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  const seen = new Set();
  const output = [];
  for (const value of ids) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    if (output.length >= 25) break;
  }
  return output;
}

function sanitiseEmojiValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'object') {
    const id = value.id ? String(value.id).trim() : '';
    const name = value.name ? String(value.name).trim() : '';
    if (!id && !name) return null;
    const cleaned = { id: id || null, name: name || null };
    if (value.animated === true) cleaned.animated = true;
    return cleaned;
  }
  return null;
}

function sanitiseEmojiMap(emojis, roleIds) {
  const map = emojis && typeof emojis === 'object' ? emojis : {};
  const ids = Array.isArray(roleIds) ? roleIds : [];
  const output = {};
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
    const value = sanitiseEmojiValue(map[id]);
    if (!value) continue;
    output[id] = value;
  }
  return output;
}

function sanitisePanel(panel) {
  if (!panel || typeof panel !== 'object') return null;
  const cleaned = { ...panel };
  cleaned.id = String(cleaned.id || '').trim();
  cleaned.guildId = cleaned.guildId ? String(cleaned.guildId) : null;
  cleaned.channelId = cleaned.channelId ? String(cleaned.channelId) : null;
  cleaned.messageId = cleaned.messageId ? String(cleaned.messageId) : null;
  cleaned.roleIds = sanitiseRoleIds(cleaned.roleIds);
  cleaned.emojis = sanitiseEmojiMap(cleaned.emojis, cleaned.roleIds);
  cleaned.multi = cleaned.multi === true;
  cleaned.createdBy = String(cleaned.createdBy || '').trim();
  cleaned.createdAt = Number.isFinite(cleaned.createdAt) ? cleaned.createdAt : Date.now();
  return cleaned.id && cleaned.guildId && cleaned.channelId && cleaned.messageId ? cleaned : null;
}

function createPanel(guildId, panel) {
  const guild = ensureGuild(guildId);
  const id = String(guild.nextId++);
  const stored = sanitisePanel({
    id,
    guildId: String(guildId),
    channelId: panel?.channelId,
    messageId: panel?.messageId,
    roleIds: panel?.roleIds,
    emojis: panel?.emojis,
    multi: panel?.multi === true,
    createdBy: panel?.createdBy,
    createdAt: Date.now(),
  });
  if (!stored) throw new Error('Invalid reaction role payload');
  guild.panels[id] = stored;
  persist();
  return { ...stored, roleIds: stored.roleIds.slice() };
}

function getPanel(guildId, panelId) {
  const guild = ensureGuild(guildId);
  const panel = guild.panels[String(panelId)];
  const cleaned = sanitisePanel(panel);
  return cleaned ? { ...cleaned, roleIds: cleaned.roleIds.slice() } : null;
}

function findPanelByMessageId(guildId, messageId) {
  const guild = ensureGuild(guildId);
  const target = String(messageId || '').trim();
  if (!target) return null;
  for (const panel of Object.values(guild.panels)) {
    if (String(panel?.messageId || '') === target) {
      const cleaned = sanitisePanel(panel);
      return cleaned ? { ...cleaned, roleIds: cleaned.roleIds.slice() } : null;
    }
  }
  return null;
}

function listPanels(guildId) {
  const guild = ensureGuild(guildId);
  return Object.values(guild.panels)
    .map(sanitisePanel)
    .filter(Boolean)
    .map(panel => ({ ...panel, roleIds: panel.roleIds.slice() }));
}

function removePanel(guildId, panelId) {
  const guild = ensureGuild(guildId);
  const key = String(panelId);
  const panel = guild.panels[key];
  if (!panel) return null;
  delete guild.panels[key];
  persist();
  return sanitisePanel(panel);
}

module.exports = {
  createPanel,
  getPanel,
  findPanelByMessageId,
  listPanels,
  removePanel,
};
