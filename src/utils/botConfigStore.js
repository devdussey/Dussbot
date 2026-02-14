const { ensureFileSync, writeJsonSync, readJsonSync } = require('./dataDir');

const STORE_FILE = 'bot_config.json';

const CATEGORY_DEFINITIONS = [
  { key: 'logging', label: 'Logging', description: 'Logging, diagnostics, and audit tools.' },
  { key: 'moderation', label: 'Moderation', description: 'Moderation and safety commands.' },
  { key: 'ai', label: 'AI', description: 'AI chat, analysis, summarize, and transcription.' },
  { key: 'games', label: 'Games', description: 'Games and community engagement commands.' },
  { key: 'admin', label: 'Admin / Owner', description: 'Administrative and owner-only utilities.' },
  { key: 'economy', label: 'Economy', description: 'Currency, rupee, and economy commands.' },
  { key: 'automations', label: 'Automations', description: 'Automations such as automessage, autorespond, and autoroles.' },
  { key: 'images', label: 'Images', description: 'Image utilities such as enlarge, removebg, and resize.' },
  { key: 'utility', label: 'Utility', description: 'Utility and general helper commands.' },
];

const DEFAULT_CATEGORY_STATE = {
  enabled: true,
  publicReplies: false,
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
  return { ...DEFAULT_CATEGORY_STATE };
}

function buildDefaultCategories() {
  const categories = {};
  for (const def of CATEGORY_DEFINITIONS) {
    categories[def.key] = getDefaultState(def.key);
  }
  return categories;
}

function normalizeCategoryState(value, key) {
  const fallback = getDefaultState(key);
  return {
    enabled: value?.enabled !== false,
    publicReplies: value?.publicReplies === true ? true : fallback.publicReplies,
  };
}

function ensureGuildConfig(guildId) {
  if (!guildId) return { categories: buildDefaultCategories() };
  const store = readStore();
  if (!store.guilds || typeof store.guilds !== 'object') store.guilds = {};

  const guildEntry = store.guilds[guildId] || {};
  const existingCategories = guildEntry.categories && typeof guildEntry.categories === 'object'
    ? guildEntry.categories
    : {};
  const normalizedCategories = {};
  let changed = !store.guilds[guildId] || !guildEntry.categories;

  for (const def of CATEGORY_DEFINITIONS) {
    const current = existingCategories[def.key];
    const normalized = normalizeCategoryState(current, def.key);
    normalizedCategories[def.key] = normalized;
    if (!current) {
      changed = true;
      continue;
    }
    if (current.enabled !== normalized.enabled || current.publicReplies !== normalized.publicReplies) {
      changed = true;
    }
  }

  for (const key of Object.keys(existingCategories)) {
    if (!getCategoryDefinition(key)) {
      changed = true;
      break;
    }
  }

  if (changed) {
    store.guilds[guildId] = {
      ...guildEntry,
      categories: normalizedCategories,
    };
    writeStore(store);
  }

  return { categories: normalizedCategories };
}

function getGuildConfig(guildId) {
  return ensureGuildConfig(guildId);
}

function updateGuildCategory(guildId, categoryKey, updater) {
  if (!guildId || !categoryKey) return null;
  const def = getCategoryDefinition(categoryKey);
  if (!def) return null;
  const existingCfg = ensureGuildConfig(guildId);
  const store = readStore();
  if (!store.guilds || typeof store.guilds !== 'object') store.guilds = {};
  if (!store.guilds[guildId]) store.guilds[guildId] = { categories: {} };
  if (!store.guilds[guildId].categories || typeof store.guilds[guildId].categories !== 'object') {
    store.guilds[guildId].categories = {};
  }
  const guildCategories = store.guilds[guildId].categories;
  const current = guildCategories[categoryKey] || existingCfg.categories?.[categoryKey] || getDefaultState(categoryKey);
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
  ensureGuildConfig,
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
