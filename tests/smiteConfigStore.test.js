const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modulePath = require.resolve('../src/utils/smiteConfigStore');
const { resetDataDirCache } = require('../src/utils/dataDir');

async function withTempStore(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smite-config-'));
  delete require.cache[modulePath];
  process.env.DISPHORIABOT_DATA_DIR = tmpDir;
  resetDataDirCache();
  const store = require(modulePath);
  try {
    await fn(store, tmpDir);
  } finally {
    delete require.cache[modulePath];
    if (store?.clearCache) store.clearCache();
    resetDataDirCache();
    delete process.env.DISPHORIABOT_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('defaults to enabled when no config exists', async () => {
  await withTempStore(async store => {
    const config = store.getConfig('guild');
    assert.equal(config.enabled, true);
    assert.deepEqual(config.immuneRoleIds, []);
    assert.deepEqual(config.storeItemCosts, {});
    assert.deepEqual(config.storeItemIds, store.DEFAULT_ENABLED_STORE_ITEM_IDS);
    assert.equal(store.isEnabled('guild'), true);
    assert.deepEqual(store.getImmuneRoleIds('guild'), []);
    assert.deepEqual(store.getStoreItemCosts('guild'), {});
    assert.deepEqual(store.getStoreItemIds('guild'), store.DEFAULT_ENABLED_STORE_ITEM_IDS);
  });
});

test('setEnabled persists preference to disk', async () => {
  await withTempStore(async (store, dir) => {
    const guildId = 'guild';
    const result = await store.setEnabled(guildId, false);
    assert.equal(result.enabled, false);
    assert.equal(store.isEnabled(guildId), false);

    const file = path.join(process.env.DISPHORIABOT_DATA_DIR, 'smite_config.json');
    assert.ok(fs.existsSync(file));
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.guilds[guildId].enabled, false);

    // Re-require to ensure persistence
    store.clearCache();
    delete require.cache[modulePath];
    const reloaded = require(modulePath);
    assert.equal(reloaded.isEnabled(guildId), false);
    assert.deepEqual(reloaded.getImmuneRoleIds(guildId), []);
  });
});

test('immune roles can be added, removed, and persisted', async () => {
  await withTempStore(async (store, dir) => {
    const guildId = 'guild';
    await store.addImmuneRole(guildId, '123');
    await store.addImmuneRole(guildId, '456');
    await store.addImmuneRole(guildId, '123'); // dedupe

    let config = store.getConfig(guildId);
    assert.deepEqual(config.immuneRoleIds.sort(), ['123', '456']);

    await store.removeImmuneRole(guildId, '123');
    config = store.getConfig(guildId);
    assert.deepEqual(config.immuneRoleIds, ['456']);

    // Persisted to disk
    const file = path.join(process.env.DISPHORIABOT_DATA_DIR, 'smite_config.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved.guilds[guildId].immuneRoleIds, ['456']);
  });
});

test('store item costs can be set, reset, and persisted per guild', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild';
    const otherGuildId = 'other';

    await store.setStoreItemCost(guildId, 'stfu', 7);
    await store.setStoreItemCost(guildId, 'muzzle', 9);
    await store.setStoreItemCost(otherGuildId, 'stfu', 3);

    let config = store.getConfig(guildId);
    assert.equal(config.storeItemCosts.stfu, 7);
    assert.equal(config.storeItemCosts.muzzle, 9);
    assert.equal(store.getConfig(otherGuildId).storeItemCosts.stfu, 3);

    await store.setStoreItemCost(guildId, 'stfu', null);
    config = store.getConfig(guildId);
    assert.equal(Object.prototype.hasOwnProperty.call(config.storeItemCosts, 'stfu'), false);
    assert.equal(config.storeItemCosts.muzzle, 9);

    const file = path.join(process.env.DISPHORIABOT_DATA_DIR, 'smite_config.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.guilds[guildId].storeItemCosts.muzzle, 9);
    assert.equal(Object.prototype.hasOwnProperty.call(saved.guilds[guildId].storeItemCosts, 'stfu'), false);
    assert.equal(saved.guilds[otherGuildId].storeItemCosts.stfu, 3);
  });
});

test('store item ids can be removed, added, and persisted per guild', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild';
    const otherGuildId = 'other';

    await store.removeStoreItem(guildId, 'stfu');
    await store.removeStoreItem(guildId, 'everyone_ping');
    await store.addStoreItem(guildId, 'stfu');
    await store.removeStoreItem(otherGuildId, 'muzzle');

    const config = store.getConfig(guildId);
    const otherConfig = store.getConfig(otherGuildId);
    assert.equal(config.storeItemIds.includes('stfu'), true);
    assert.equal(config.storeItemIds.includes('everyone_ping'), false);
    assert.equal(otherConfig.storeItemIds.includes('muzzle'), false);

    const file = path.join(process.env.DISPHORIABOT_DATA_DIR, 'smite_config.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.guilds[guildId].storeItemIds.includes('everyone_ping'), false);
    assert.equal(saved.guilds[guildId].storeItemIds.includes('stfu'), true);
    assert.equal(saved.guilds[otherGuildId].storeItemIds.includes('muzzle'), false);
  });
});
