const { ensureFileSync, writeJsonSync, readJsonSync } = require('./dataDir');

const STORE_FILE = 'bot_config.json';

const CATEGORY_DEFINITIONS = [
  { key: 'logging', label: 'Logging', description: 'Logging, diagnostics, and audit tools.' },
  { key: 'moderation', label: 'Moderation', description: 'Moderation and safety commands.' },
  { key: 'ai', label: 'AI', description: 'AI chat, analysis, summarize, and transcription.' },
  { key: 'games', label: 'Games', description: 'Games and community engagement commands.' },
  { key: 'admin', label: 'Admin / Owner', description: 'Administrative and owner-only utilities.' },
  { key: 'economy', label: 'Economy', description: 'Currency, rupee, and economy commands.' },
  { key: 'automations', label: 'Automations', description: 'Automations such as autobump, autorespond, and autoroles.' },
  { key: 'images', label: 'Images', description: 'Image utilities such as enlarge and removebg.' },
  { key: 'utility', label: 'Utility', description: 'Utility and general helper commands.' },
];

const DEFAULT_CATEGORY_STATE = {
  enabled: true,
  publicReplies: true,
};

const CATEGORY_DEFAULTS = {
  logging: { publicReplies: false },
  moderation: { publicReplies: false },
  ai: { publicReplies: false },
  games: { publicReplies: true },
  admin: { publicReplies: false },
  economy: { publicReplies: false },
  automations: { publicReplies: false },
  images: { publicReplies: false },
  utility: { publicReplies: false },
};

function ensureStore() {
  try {
    ensureFileSync(STORE_FILE, { guilds: {} });
  } catch (err) {
    console.error('Failed to ensure bot config store:', err);
  }
}

function readStore() {
  ensureStore();
  try {
    return readJsonSync(STORE_FILE, { guilds: {} }) || { guilds: {} };
  } catch (_) {
    return { guilds: {} };
  }
}

function writeStore(store) {
  ensureStore();
  const safe = store || { guilds: {} };
  writeJsonSync(STORE_FILE, safe);
}

function listCategories() {
  return CATEGORY_DEFINITIONS.slice();
}

function getCategoryDefinition(key) {
  return CATEGORY_DEFINITIONS.find(c => c.key === key) || null;
}

function getDefaultState(key) {
  return { ...DEFAULT_CATEGORY_STATE, ...(CATEGORY_DEFAULTS[key] || {}) };
}

function getGuildConfig(guildId) {
  if (!guildId) return { categories: {} };
  const store = readStore();
  const existing = store.guilds?.[guildId] || {};
  const categories = { ...(existing.categories || {}) };
  for (const def of CATEGORY_DEFINITIONS) {
    if (!categories[def.key]) {
      categories[def.key] = getDefaultState(def.key);
    } else {
      categories[def.key] = {
        enabled: categories[def.key].enabled !== false,
        publicReplies: categories[def.key].publicReplies === true,
      };
    }
  }
  return { categories };
}

function updateGuildCategory(guildId, categoryKey, updater) {
  if (!guildId || !categoryKey) return null;
  const def = getCategoryDefinition(categoryKey);
  if (!def) return null;
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = { categories: {} };
  const guildCategories = store.guilds[guildId].categories;
  const current = guildCategories[categoryKey] || getDefaultState(categoryKey);
  const next = { ...current, ...updater(current) };
  guildCategories[categoryKey] = {
    enabled: next.enabled !== false,
    publicReplies: next.publicReplies === true,
  };
  writeStore(store);
  return guildCategories[categoryKey];
}

function setCategoryEnabled(guildId, categoryKey, enabled) {
  return updateGuildCategory(guildId, categoryKey, () => ({ enabled: !!enabled }));
}

function toggleCategoryEnabled(guildId, categoryKey) {
  return updateGuildCategory(guildId, categoryKey, cur => ({ enabled: !cur.enabled }));
}

function setCategoryPublicReplies(guildId, categoryKey, publicReplies) {
  return updateGuildCategory(guildId, categoryKey, () => ({ publicReplies: !!publicReplies }));
}

function toggleCategoryPublicReplies(guildId, categoryKey) {
  return updateGuildCategory(guildId, categoryKey, cur => ({ publicReplies: !cur.publicReplies }));
}

function resetGuildConfig(guildId) {
  if (!guildId) return;
  const store = readStore();
  delete store.guilds[guildId];
  writeStore(store);
}

function isCategoryEnabled(guildId, categoryKey, fallback = true) {
  const cfg = getGuildConfig(guildId);
  return cfg.categories?.[categoryKey]?.enabled ?? fallback;
}

function areRepliesPublic(guildId, categoryKey, fallbackPublic = false) {
  const cfg = getGuildConfig(guildId);
  return cfg.categories?.[categoryKey]?.publicReplies ?? fallbackPublic;
}

function shouldReplyEphemeral(guildId, categoryKey, fallbackEphemeral = true) {
  // If public replies are preferred, ephemeral should be false.
  const publicPreferred = areRepliesPublic(guildId, categoryKey, !fallbackEphemeral);
  return !publicPreferred;
}

module.exports = {
  listCategories,
  getCategoryDefinition,
  getGuildConfig,
  setCategoryEnabled,
  toggleCategoryEnabled,
  setCategoryPublicReplies,
  toggleCategoryPublicReplies,
  resetGuildConfig,
  isCategoryEnabled,
  areRepliesPublic,
  shouldReplyEphemeral,
};
