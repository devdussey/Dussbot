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

function seedIsolatedStoreFile(tmpDir) {
  const target = path.join(tmpDir, 'word_stats_config.json');
  fs.writeFileSync(target, JSON.stringify({ guilds: {} }, null, 2), 'utf8');
}

test('setTrackedChannel + recordTrackedMessage only tracks configured channel', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

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

test('recordTrackedMessage ignores duplicate message IDs for counts and stats', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

  t.after(() => {
    if (typeof prev === 'string') process.env.DISPHORIABOT_DATA_DIR = prev;
    else delete process.env.DISPHORIABOT_DATA_DIR;
    dataDir.resetDataDirCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const store = freshStore();
  await store.setTrackedChannel('g1', 'c1');

  const first = await store.recordTrackedMessage('g1', 'c1', 'u1', 'Alpha#0001', {
    id: 'm-duplicate-1',
    content: 'hello hello <:wave:1234567890>',
    attachments: new Map([['a1', { name: 'image.png', contentType: 'image/png' }]]),
    stickers: new Map(),
  });
  const second = await store.recordTrackedMessage('g1', 'c1', 'u1', 'Alpha#0001', {
    id: 'm-duplicate-1',
    content: 'hello hello <:wave:1234567890>',
    attachments: new Map([['a1', { name: 'image.png', contentType: 'image/png' }]]),
    stickers: new Map(),
  });

  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.reason, 'duplicate-message');

  const config = store.getConfig('g1');
  assert.equal(config.totalMessages, 1);

  const topWords = store.getTopWords('g1');
  assert.equal(topWords.entries[0].word, 'hello');
  assert.equal(topWords.entries[0].totalCount, 2);

  const mediaLeaders = store.getTopMediaUsers('g1');
  assert.equal(mediaLeaders.entries.length, 1);
  assert.equal(mediaLeaders.entries[0].mediaCount, 1);
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.images, 1);
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.emojis, 1);
});

test('parseBackfillPayload supports multiple JSON shapes', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

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
  seedIsolatedStoreFile(tmp);

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

test('parseBackfillPayload dedupes message IDs in arrays and keeps media/word detail', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

  t.after(() => {
    if (typeof prev === 'string') process.env.DISPHORIABOT_DATA_DIR = prev;
    else delete process.env.DISPHORIABOT_DATA_DIR;
    dataDir.resetDataDirCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const store = freshStore();
  const entries = store.parseBackfillPayload({
    users: {
      u1: {
        messages: [
          { id: 'm1', content: 'hello hello' },
          { id: 'm1', content: 'hello hello' },
          {
            id: 'm2',
            content: '<:wave:1234567890>',
            attachments: [{ name: 'photo.png', contentType: 'image/png' }],
            stickers: [],
          },
        ],
      },
    },
  }, 'g1');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].userId, 'u1');
  assert.equal(entries[0].count, 2);
  assert.equal(entries[0].textCount, 1);
  assert.equal(entries[0].mediaCount, 1);
  assert.equal(entries[0].mediaBreakdown.images, 1);
  assert.equal(entries[0].mediaBreakdown.emojis, 1);
  assert.equal(entries[0].words.hello, 2);

  const imported = await store.importBackfill('g1', entries);
  assert.equal(imported.importedMessages, 2);

  const topWords = store.getTopWords('g1');
  assert.equal(topWords.entries[0].word, 'hello');
  assert.equal(topWords.entries[0].totalCount, 2);

  const mediaLeaders = store.getTopMediaUsers('g1');
  assert.equal(mediaLeaders.entries.length, 1);
  assert.equal(mediaLeaders.entries[0].userId, 'u1');
  assert.equal(mediaLeaders.entries[0].mediaCount, 1);
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.images, 1);
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.emojis, 1);
});

test('parseBackfillPayload supports txt_only_scan style exports', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

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

test('recordTrackedMessage stores word usage and media breakdowns for queries', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

  t.after(() => {
    if (typeof prev === 'string') process.env.DISPHORIABOT_DATA_DIR = prev;
    else delete process.env.DISPHORIABOT_DATA_DIR;
    dataDir.resetDataDirCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const store = freshStore();
  await store.setTrackedChannel('g1', 'c1');

  await store.recordTrackedMessage('g1', 'c1', 'u1', 'Alpha#0001', {
    content: 'hello hello world',
    attachments: new Map(),
    stickers: new Map(),
  });

  await store.recordTrackedMessage('g1', 'c1', 'u2', 'Beta#0001', {
    content: 'check this 😀 <:wave:1234567890>',
    attachments: new Map([['a1', { name: 'photo.png', contentType: 'image/png' }]]),
    stickers: new Map(),
  });

  await store.recordTrackedMessage('g1', 'c1', 'u2', 'Beta#0001', {
    content: '',
    attachments: new Map(),
    stickers: new Map([['s1', { id: 'sticker1', name: 'Sticker One' }]]),
  });

  const topUsers = store.getTopUsers('g1');
  assert.equal(topUsers.entries[0].userId, 'u2');
  assert.equal(topUsers.entries[0].count, 2);
  assert.equal(topUsers.entries[0].textCount, 0);
  assert.equal(topUsers.entries[0].mediaCount, 2);

  const topWords = store.getTopWords('g1');
  assert.equal(topWords.entries[0].word, 'hello');
  assert.equal(topWords.entries[0].totalCount, 2);
  assert.equal(topWords.entries[0].topUserId, 'u1');
  assert.equal(topWords.entries[0].topUserCount, 2);

  const helloUsage = store.searchWordUsage('g1', 'hello');
  assert.equal(helloUsage.totalMatches, 2);
  assert.equal(helloUsage.users.length, 1);
  assert.equal(helloUsage.users[0].userId, 'u1');
  assert.equal(helloUsage.users[0].count, 2);

  const mediaLeaders = store.getTopMediaUsers('g1');
  assert.equal(mediaLeaders.entries.length, 1);
  assert.equal(mediaLeaders.entries[0].userId, 'u2');
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.images, 1);
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.stickers, 1);
  assert.equal(mediaLeaders.entries[0].mediaBreakdown.emojis, 2);

  const u1Stats = store.getUserWordStats('g1', 'u1');
  assert.equal(u1Stats.count, 1);
  assert.equal(u1Stats.topWords[0].word, 'hello');
  assert.equal(u1Stats.topWords[0].count, 2);
});

test('parseBackfillPayload + importBackfill keep enriched media and word stats', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordstatscfg-'));
  const prev = process.env.DISPHORIABOT_DATA_DIR;
  process.env.DISPHORIABOT_DATA_DIR = tmp;
  dataDir.resetDataDirCache();
  seedIsolatedStoreFile(tmp);

  t.after(() => {
    if (typeof prev === 'string') process.env.DISPHORIABOT_DATA_DIR = prev;
    else delete process.env.DISPHORIABOT_DATA_DIR;
    dataDir.resetDataDirCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const store = freshStore();
  const parsed = store.parseBackfillPayload({
    entries: [
      {
        userId: 'u10',
        tag: 'Gamma#0001',
        count: 8,
        textCount: 5,
        mediaCount: 3,
        mediaBreakdown: { images: 2, stickers: 1, emojis: 7 },
        words: { hello: 4, world: 2 },
      },
    ],
  }, 'g1');

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].userId, 'u10');
  assert.equal(parsed[0].count, 8);
  assert.equal(parsed[0].textCount, 5);
  assert.equal(parsed[0].mediaCount, 3);
  assert.equal(parsed[0].mediaBreakdown.images, 2);
  assert.equal(parsed[0].words.hello, 4);

  const imported = await store.importBackfill('g1', parsed);
  assert.equal(imported.importedMessages, 8);

  const userStats = store.getUserWordStats('g1', 'u10');
  assert.equal(userStats.count, 8);
  assert.equal(userStats.textCount, 5);
  assert.equal(userStats.mediaCount, 3);
  assert.equal(userStats.mediaBreakdown.images, 2);
  assert.equal(userStats.mediaBreakdown.stickers, 1);
  assert.equal(userStats.mediaBreakdown.emojis, 7);
  assert.equal(userStats.topWords[0].word, 'hello');
  assert.equal(userStats.topWords[0].count, 4);
});
