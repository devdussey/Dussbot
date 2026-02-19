const { ensureFileSync, writeJson, readJsonSync } = require('./dataDir');

const STORE_FILE = 'smite_config.json';
const DEFAULT_MESSAGE_THRESHOLD = 500;
const DEFAULT_VOICE_MINUTES_PER_RUPEE = 15;
const DEFAULT_CURRENCY_NAME = 'Rupee';
const DEFAULT_STORE_ITEM_COSTS = Object.freeze({
  stfu: 5,
  muzzle: 5,
  abuse_mod: 15,
  nickname: 5,
  nickname_member: 10,
  custom_role_solid: 5,
  custom_role_gradient: 15,
  everyone_ping: 15,
});
const DEFAULT_ENABLED_STORE_ITEM_IDS = Object.freeze(Object.keys(DEFAULT_STORE_ITEM_COSTS));
let cache = null;

function normaliseRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return [];
  const seen = new Set();
  for (const raw of roleIds) {
    if (!raw) continue;
    const id = String(raw);
    if (id) seen.add(id);
  }
  return Array.from(seen);
}

function normalisePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const whole = Math.floor(num);
  return whole >= 1 ? whole : fallback;
}

function normaliseOptionalId(value) {
  if (value === null || typeof value === 'undefined') return null;
  const id = String(value).trim();
  return id ? id : null;
}

function normaliseCurrencyName(value, fallback = DEFAULT_CURRENCY_NAME) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const collapsed = raw.replace(/\s+/g, ' ');
  if (!collapsed) return fallback;
  return collapsed.slice(0, 32);
}

function normaliseStoreItemCosts(value) {
  const output = {};
  if (!value || typeof value !== 'object') return output;
  for (const [itemId, rawCost] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_STORE_ITEM_COSTS, itemId)) continue;
    const cost = normalisePositiveInt(rawCost, null);
    if (cost !== null) output[itemId] = cost;
  }
  return output;
}

function normaliseStoreItemIds(value, fallback = DEFAULT_ENABLED_STORE_ITEM_IDS) {
  const source = Array.isArray(value) ? value : fallback;
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  for (const raw of source) {
    if (!raw) continue;
    const itemId = String(raw);
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_STORE_ITEM_COSTS, itemId)) continue;
    if (seen.has(itemId)) continue;
    seen.add(itemId);
  }
  return Array.from(seen);
}

function ensureStore() {
  ensureFileSync(STORE_FILE, { guilds: {} });
}

function loadStore() {
  if (cache) return cache;
  ensureStore();
  try {
    const data = readJsonSync(STORE_FILE, { guilds: {} });
    if (!data || typeof data !== 'object') {
      cache = { guilds: {} };
    } else {
      if (!data.guilds || typeof data.guilds !== 'object') data.guilds = {};
      cache = data;
    }
  } catch (err) {
    console.error('Failed to load smite config store', err);
    cache = { guilds: {} };
  }
  return cache;
}

async function saveStore() {
  const store = loadStore();
  const safe = store && typeof store === 'object' ? store : { guilds: {} };
  if (!safe.guilds || typeof safe.guilds !== 'object') safe.guilds = {};
  await writeJson(STORE_FILE, safe);
}

function getGuildRecord(guildId) {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = {
      enabled: true,
      immuneRoleIds: [],
      messageThreshold: DEFAULT_MESSAGE_THRESHOLD,
      voiceMinutesPerRupee: DEFAULT_VOICE_MINUTES_PER_RUPEE,
      currencyName: DEFAULT_CURRENCY_NAME,
      announceChannelId: null,
      storePanelChannelId: null,
      storeItemCosts: {},
      storeItemIds: [...DEFAULT_ENABLED_STORE_ITEM_IDS],
    };
  }
  const guild = store.guilds[guildId];
  if (typeof guild.enabled !== 'boolean') guild.enabled = true;
  if (!Array.isArray(guild.immuneRoleIds)) guild.immuneRoleIds = [];
  guild.immuneRoleIds = normaliseRoleIds(guild.immuneRoleIds);
  guild.messageThreshold = normalisePositiveInt(guild.messageThreshold, DEFAULT_MESSAGE_THRESHOLD);
  guild.voiceMinutesPerRupee = normalisePositiveInt(guild.voiceMinutesPerRupee, DEFAULT_VOICE_MINUTES_PER_RUPEE);
  guild.currencyName = normaliseCurrencyName(guild.currencyName, DEFAULT_CURRENCY_NAME);
  guild.announceChannelId = normaliseOptionalId(guild.announceChannelId);
  guild.storePanelChannelId = normaliseOptionalId(guild.storePanelChannelId);
  guild.storeItemCosts = normaliseStoreItemCosts(guild.storeItemCosts);
  guild.storeItemIds = normaliseStoreItemIds(guild.storeItemIds, DEFAULT_ENABLED_STORE_ITEM_IDS);
  return guild;
}

function getConfig(guildId) {
  if (!guildId) {
    return {
      enabled: true,
      updatedAt: null,
      immuneRoleIds: [],
      messageThreshold: DEFAULT_MESSAGE_THRESHOLD,
      voiceMinutesPerRupee: DEFAULT_VOICE_MINUTES_PER_RUPEE,
      currencyName: DEFAULT_CURRENCY_NAME,
      announceChannelId: null,
      storePanelChannelId: null,
      storeItemCosts: {},
      storeItemIds: [...DEFAULT_ENABLED_STORE_ITEM_IDS],
    };
  }
  const guild = getGuildRecord(guildId);
  return {
    enabled: guild.enabled !== false,
    updatedAt: guild.updatedAt ?? null,
    immuneRoleIds: guild.immuneRoleIds || [],
    messageThreshold: guild.messageThreshold,
    voiceMinutesPerRupee: guild.voiceMinutesPerRupee,
    currencyName: normaliseCurrencyName(guild.currencyName, DEFAULT_CURRENCY_NAME),
    announceChannelId: guild.announceChannelId,
    storePanelChannelId: guild.storePanelChannelId,
    storeItemCosts: normaliseStoreItemCosts(guild.storeItemCosts),
    storeItemIds: normaliseStoreItemIds(guild.storeItemIds, DEFAULT_ENABLED_STORE_ITEM_IDS),
  };
}

function isEnabled(guildId) {
  return getConfig(guildId).enabled;
}

function getImmuneRoleIds(guildId) {
  return getConfig(guildId).immuneRoleIds;
}

function getMessageThreshold(guildId) {
  return getConfig(guildId).messageThreshold;
}

function getVoiceMinutesPerRupee(guildId) {
  return getConfig(guildId).voiceMinutesPerRupee;
}

function getAnnounceChannelId(guildId) {
  return getConfig(guildId).announceChannelId;
}

function getStorePanelChannelId(guildId) {
  return getConfig(guildId).storePanelChannelId;
}

function getCurrencyName(guildId) {
  return getConfig(guildId).currencyName;
}

function getStoreItemCosts(guildId) {
  return getConfig(guildId).storeItemCosts || {};
}

function getStoreItemIds(guildId) {
  return getConfig(guildId).storeItemIds || [];
}

async function setEnabled(guildId, enabled) {
  if (!guildId) {
    return getConfig(guildId);
  }
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    enabled: !!enabled,
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setImmuneRoleIds(guildId, roleIds) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    immuneRoleIds: normaliseRoleIds(roleIds),
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setEarningRates(guildId, rates = {}) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  const nextMessageThreshold = normalisePositiveInt(
    rates.messageThreshold,
    current.messageThreshold || DEFAULT_MESSAGE_THRESHOLD,
  );
  const nextVoiceMinutesPerRupee = normalisePositiveInt(
    rates.voiceMinutesPerRupee,
    current.voiceMinutesPerRupee || DEFAULT_VOICE_MINUTES_PER_RUPEE,
  );

  store.guilds[guildId] = {
    ...current,
    messageThreshold: nextMessageThreshold,
    voiceMinutesPerRupee: nextVoiceMinutesPerRupee,
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setAnnounceChannelId(guildId, channelId) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    announceChannelId: normaliseOptionalId(channelId),
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setStorePanelChannelId(guildId, channelId) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    storePanelChannelId: normaliseOptionalId(channelId),
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setCurrencyName(guildId, currencyName) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    currencyName: normaliseCurrencyName(currencyName, DEFAULT_CURRENCY_NAME),
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setStoreItemCost(guildId, itemId, cost) {
  if (!guildId || !itemId || !Object.prototype.hasOwnProperty.call(DEFAULT_STORE_ITEM_COSTS, itemId)) {
    return getConfig(guildId);
  }
  const store = loadStore();
  const current = getGuildRecord(guildId);
  const nextStoreItemCosts = normaliseStoreItemCosts(current.storeItemCosts);
  if (cost === null || typeof cost === 'undefined') {
    delete nextStoreItemCosts[itemId];
  } else {
    const parsed = normalisePositiveInt(cost, null);
    if (parsed === null) return getConfig(guildId);
    nextStoreItemCosts[itemId] = parsed;
  }
  store.guilds[guildId] = {
    ...current,
    storeItemCosts: nextStoreItemCosts,
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setStoreItemCosts(guildId, costs) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    storeItemCosts: normaliseStoreItemCosts(costs),
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function setStoreItemIds(guildId, itemIds) {
  if (!guildId) return getConfig(guildId);
  const store = loadStore();
  const current = getGuildRecord(guildId);
  store.guilds[guildId] = {
    ...current,
    storeItemIds: normaliseStoreItemIds(itemIds, []),
    updatedAt: new Date().toISOString(),
  };
  await saveStore();
  return getConfig(guildId);
}

async function addStoreItem(guildId, itemId) {
  if (!guildId || !itemId || !Object.prototype.hasOwnProperty.call(DEFAULT_STORE_ITEM_COSTS, itemId)) {
    return getConfig(guildId);
  }
  const current = getGuildRecord(guildId);
  if (current.storeItemIds.includes(itemId)) return getConfig(guildId);
  return setStoreItemIds(guildId, [...current.storeItemIds, itemId]);
}

async function removeStoreItem(guildId, itemId) {
  if (!guildId || !itemId || !Object.prototype.hasOwnProperty.call(DEFAULT_STORE_ITEM_COSTS, itemId)) {
    return getConfig(guildId);
  }
  const current = getGuildRecord(guildId);
  if (!current.storeItemIds.includes(itemId)) return getConfig(guildId);
  return setStoreItemIds(guildId, current.storeItemIds.filter(id => id !== itemId));
}

async function addImmuneRole(guildId, roleId) {
  if (!guildId || !roleId) return getConfig(guildId);
  const current = getGuildRecord(guildId);
  const updated = normaliseRoleIds([...current.immuneRoleIds, roleId]);
  return setImmuneRoleIds(guildId, updated);
}

async function removeImmuneRole(guildId, roleId) {
  if (!guildId || !roleId) return getConfig(guildId);
  const current = getGuildRecord(guildId);
  const updated = current.immuneRoleIds.filter(id => String(id) !== String(roleId));
  return setImmuneRoleIds(guildId, updated);
}

function clearCache() {
  cache = null;
}

module.exports = {
  DEFAULT_MESSAGE_THRESHOLD,
  DEFAULT_VOICE_MINUTES_PER_RUPEE,
  DEFAULT_CURRENCY_NAME,
  DEFAULT_STORE_ITEM_COSTS,
  DEFAULT_ENABLED_STORE_ITEM_IDS,
  getConfig,
  isEnabled,
  getImmuneRoleIds,
  getMessageThreshold,
  getVoiceMinutesPerRupee,
  getAnnounceChannelId,
  getStorePanelChannelId,
  getCurrencyName,
  getStoreItemCosts,
  getStoreItemIds,
  setEnabled,
  setImmuneRoleIds,
  setEarningRates,
  setAnnounceChannelId,
  setStorePanelChannelId,
  setCurrencyName,
  setStoreItemCost,
  setStoreItemCosts,
  setStoreItemIds,
  addStoreItem,
  removeStoreItem,
  addImmuneRole,
  removeImmuneRole,
  clearCache,
};
