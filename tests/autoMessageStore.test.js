const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modulePath = require.resolve('../src/utils/autoMessageStore');
const { resetDataDirCache } = require('../src/utils/dataDir');

async function withTempStore(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automessage-store-'));
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

test('addJob keeps valid embed image URL', async () => {
  await withTempStore(async (store) => {
    const job = await store.addJob('guild-1', {
      channelId: '123',
      content: '',
      embed: { title: 'Hello', image: { url: 'https://cdn.example.com/promo.gif' } },
      intervalMs: 3_600_000,
    });

    assert.equal(job.embed.title, 'Hello');
    assert.equal(job.embed.image.url, 'https://cdn.example.com/promo.gif');
  });
});

test('addJob strips invalid embed image URL', async () => {
  await withTempStore(async (store) => {
    const job = await store.addJob('guild-2', {
      channelId: '456',
      content: '',
      embed: { image: 'ftp://example.com/not-allowed.gif' },
      intervalMs: 3_600_000,
    });

    assert.equal(job.embed, null);
  });
});
