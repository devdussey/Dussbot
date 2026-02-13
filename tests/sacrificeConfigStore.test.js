const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modulePath = require.resolve('../src/utils/sacrificeConfigStore');
const { resetDataDirCache } = require('../src/utils/dataDir');

async function withTempStore(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sacrifice-config-'));
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

test('setPanelGif/getPanelGif persist and return gif URLs', async () => {
  await withTempStore(async (store, tmpDir) => {
    const guildId = 'guild-1';
    const channelId = 'channel-1';
    const gif = 'https://cdn.example.com/test.gif';

    await store.setPanelGif(guildId, channelId, gif);
    assert.equal(store.getPanelGif(guildId, channelId), gif);

    const file = path.join(tmpDir, 'sacrifice_config.json');
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.guilds[guildId].channels[channelId].gifUrl, gif);
  });
});

test('setPanelGif clears record when url is empty', async () => {
  await withTempStore(async (store) => {
    const guildId = 'guild-2';
    const channelId = 'channel-2';

    await store.setPanelGif(guildId, channelId, 'https://cdn.example.com/a.gif');
    assert.equal(store.getPanelGif(guildId, channelId), 'https://cdn.example.com/a.gif');

    await store.setPanelGif(guildId, channelId, null);
    assert.equal(store.getPanelGif(guildId, channelId), null);
  });
});
