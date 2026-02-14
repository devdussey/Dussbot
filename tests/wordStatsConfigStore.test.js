const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dataDir = require('../src/utils/dataDir');

function freshStore() {
  delete require.cache[require.resolve('../src/utils/wordStatsConfigStore')];
  return require('../src/utils/wordStatsConfigStore');
}

test('setTrackedChannel + recordTrackedMessage only tracks configured channel', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();

  t.after(() => {
    if (typeof prev === 'string') process.env.DISPHORIABOT_DATA_DIR = prev;
    else delete process.env.DISPHORIABOT_DATA_DIR;
    dataDir.resetDataDirCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const store = freshStore();
  await store.setTrackedChannel('g1', 'c1');
  const ignored = await store.recordTrackedMessage('g1', 'c2', 'u1', 'User#1');
  assert.equal(ignored.recorded, false);

  const recorded = await store.recordTrackedMessage('g1', 'c1', 'u1', 'User#1');
  assert.equal(recorded.recorded, true);

  const config = store.getConfig('g1');
  assert.equal(config.trackedChannelId, 'c1');
  assert.equal(config.totalMessages, 1);
});

test('parseBackfillPayload supports multiple JSON shapes', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();

  t.after(() => {
    if (typeof prev === 'string') process.env.DISPHORIABOT_DATA_DIR = prev;
    else delete process.env.DISPHORIABOT_DATA_DIR;
    dataDir.resetDataDirCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const store = freshStore();

  const entries = store.parseBackfillPayload({ guilds: { g1: { users: { u1: { count: 2 }, u2: 4 } } } }, 'g1');
  assert.equal(entries.length, 2);

  const imported = await store.importBackfill('g1', entries);
  assert.equal(imported.importedMessages, 6);
  assert.equal(store.getConfig('g1').totalMessages, 6);
});
