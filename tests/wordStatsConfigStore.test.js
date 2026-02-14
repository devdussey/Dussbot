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

test('parseBackfillPayload accepts message arrays, alternate fields, and numeric strings', async (t) => {
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

  const fromMessageLogExport = store.parseBackfillPayload({
    guilds: {
      g1: {
        users: {
          u1: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
          u2: { messages: [{ id: 'm4' }, { id: 'm5' }], authorTag: 'UserTwo#0001' },
        },
      },
    },
  }, 'g1');
  assert.equal(fromMessageLogExport.find((entry) => entry.userId === 'u1')?.count, 3);
  assert.equal(fromMessageLogExport.find((entry) => entry.userId === 'u2')?.count, 2);
  assert.equal(fromMessageLogExport.find((entry) => entry.userId === 'u2')?.lastKnownTag, 'UserTwo#0001');

  const fromEntries = store.parseBackfillPayload({
    entries: [
      { id: 'u3', messageCount: '7', tag: 'UserThree#0001' },
      { user_id: 'u4', totalMessages: '5' },
    ],
  }, 'g1');
  assert.equal(fromEntries.find((entry) => entry.userId === 'u3')?.count, 7);
  assert.equal(fromEntries.find((entry) => entry.userId === 'u4')?.count, 5);

  const fromTopLevelMap = store.parseBackfillPayload({
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    u5: '4',
  }, 'g1');
  assert.equal(fromTopLevelMap.length, 1);
  assert.equal(fromTopLevelMap[0]?.userId, 'u5');
  assert.equal(fromTopLevelMap[0]?.count, 4);
});

test('parseBackfillPayload supports txt_only_scan style exports', async (t) => {
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

  const entries = store.parseBackfillPayload({
    exported_at: '2026-02-14T06:41:41.867502+00:00',
    guild: { name: 'Disphoria', id: '1448087746596835571' },
    channel: { name: 'general-chat-hat', id: '1448087747557589215' },
    stats: {
      total_messages_scanned: 20,
      total_matched: 17,
      per_user_totals: [
        { user: 'alpha [111111111111111111]', count: 12 },
        { user: 'beta [222222222222222222]', count: 5 },
      ],
    },
  }, '1448087746596835571');

  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.userId === '111111111111111111')?.count, 12);
  assert.equal(entries.find((entry) => entry.userId === '111111111111111111')?.lastKnownTag, 'alpha');
  assert.equal(entries.find((entry) => entry.userId === '222222222222222222')?.count, 5);
});
