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

test('allows two nominations then blocks until reset', async () => {
  await withTempStore(async (store, tmpDir) => {
    const guildId = 'guild-1';
    const userId = 'user-1';
    const start = Date.now();

    const first = await store.consumeNomination(guildId, userId, start);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);

    const second = await store.consumeNomination(guildId, userId, start + 1_000);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);
    assert.ok(second.resetAt);

    const third = await store.consumeNomination(guildId, userId, start + 2_000);
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
    assert.ok(third.retryAfterMs > 0);

    const file = path.join(tmpDir, 'sacrifice_nominations.json');
    assert.ok(fs.existsSync(file));
  });
});

test('resets usage after 24 hours from second nomination', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-2';
    const userId = 'user-2';
    const start = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    await store.consumeNomination(guildId, userId, start);
    await store.consumeNomination(guildId, userId, start + 2_000);

    const beforeReset = await store.consumeNomination(guildId, userId, start + dayMs - 1);
    assert.equal(beforeReset.allowed, false);

    const afterReset = await store.consumeNomination(guildId, userId, start + 2_000 + dayMs + 1);
    assert.equal(afterReset.allowed, true);
    assert.equal(afterReset.remaining, 1);
  });
});

test('rollback removes consumed usage slot', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-3';
    const userId = 'user-3';
    const start = Date.now();

    const second = await store.consumeNomination(guildId, userId, start);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 1);

    await store.rollbackLastNomination(guildId, userId);

    const firstAgain = await store.consumeNomination(guildId, userId, start + 1_000);
    assert.equal(firstAgain.allowed, true);
    assert.equal(firstAgain.remaining, 1);
  });
});
