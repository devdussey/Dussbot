const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modulePath = require.resolve('../src/utils/sacrificeNominationStore');
const { resetDataDirCache } = require('../src/utils/dataDir');

async function withTempStore(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sacrifice-nominations-'));
  delete require.cache[modulePath];
  process.env.DISPHORIABOT_DATA_DIR = tmpDir;
  resetDataDirCache();
  const store = require(modulePath);
  try {
    await fn(store, tmpDir);
  } finally {
    delete require.cache[modulePath];
    resetDataDirCache();
    delete process.env.DISPHORIABOT_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('allows one nomination then blocks the same user for 24 hours', async () => {
  await withTempStore(async (store, tmpDir) => {
    const guildId = 'guild-1';
    const userId = 'user-1';
    const targetId = 'target-1';
    const start = Date.now();

    const first = await store.consumeNomination(guildId, userId, targetId, start);
    assert.equal(first.allowed, true);
    assert.equal(first.targetNominationCount, 1);

    const second = await store.consumeNomination(guildId, userId, targetId, start + 1_000);
    assert.equal(second.allowed, false);
    assert.ok(second.retryAfterMs > 0);

    const file = path.join(tmpDir, 'sacrifice_nominations.json');
    assert.ok(fs.existsSync(file));
  });
});

test('same user can nominate again after 24 hours', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-2';
    const userId = 'user-2';
    const targetId = 'target-2';
    const start = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    await store.consumeNomination(guildId, userId, targetId, start);
    const beforeReset = await store.consumeNomination(guildId, userId, targetId, start + dayMs - 1);
    assert.equal(beforeReset.allowed, false);

    const afterReset = await store.consumeNomination(guildId, userId, targetId, start + dayMs + 1);
    assert.equal(afterReset.allowed, true);
  });
});

test('cooldown can be bypassed for unlimited owner nominations', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-owner';
    const userId = 'owner-user';
    const targetId = 'target-owner';
    const start = Date.now();

    const first = await store.consumeNomination(guildId, userId, targetId, start, { bypassCooldown: true });
    assert.equal(first.allowed, true);
    assert.equal(first.targetNominationCount, 1);

    const second = await store.consumeNomination(guildId, userId, targetId, start + 1000, { bypassCooldown: true });
    assert.equal(second.allowed, true);
    assert.equal(second.targetNominationCount, 2);
  });
});

test('target nomination counts increase across different nominators', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-3';
    const targetId = 'target-3';
    const start = Date.now();

    const first = await store.consumeNomination(guildId, 'user-a', targetId, start);
    assert.equal(first.allowed, true);
    assert.equal(first.targetNominationCount, 1);

    const second = await store.consumeNomination(guildId, 'user-b', targetId, start + 1_000);
    assert.equal(second.allowed, true);
    assert.equal(second.targetNominationCount, 2);
  });
});

test('rollback reverts cooldown and target count on failure', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-4';
    const userId = 'user-rollback';
    const targetId = 'target-rollback';
    const start = Date.now();

    const result = await store.consumeNomination(guildId, userId, targetId, start);
    assert.equal(result.allowed, true);
    assert.equal(result.targetNominationCount, 1);

    await store.rollbackLastNomination(guildId, result.rollbackToken);

    const retry = await store.consumeNomination(guildId, userId, targetId, start + 1_000);
    assert.equal(retry.allowed, true);
    assert.equal(retry.targetNominationCount, 1);
  });
});
