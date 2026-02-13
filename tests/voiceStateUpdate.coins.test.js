const test = require('node:test');
const assert = require('node:assert/strict');

const eventPath = require.resolve('../src/events/voiceStateUpdate.coins');
const coinStore = require('../src/utils/coinStore');
const rupeeStore = require('../src/utils/rupeeStore');
const smiteConfigStore = require('../src/utils/smiteConfigStore');

function loadHandler() {
  delete require.cache[eventPath];
  return require(eventPath);
}

function mkState({ guildId = 'g1', userId = 'u1', channelId = null, guild } = {}) {
  return {
    id: userId,
    channelId,
    guild: guild || { id: guildId },
  };
}

test('awards one rupee after 15 minutes in voice', async () => {
  const handler = loadHandler();
  const originalNow = Date.now;
  const originalAddCoins = coinStore.addCoins;
  const originalAddTokens = rupeeStore.addTokens;
  const originalEnabled = smiteConfigStore.isEnabled;

  const coinCalls = [];
  const rupeeCalls = [];

  coinStore.addCoins = async (guildId, userId, amount) => {
    coinCalls.push({ guildId, userId, amount });
  };
  rupeeStore.addTokens = async (guildId, userId, amount) => {
    rupeeCalls.push({ guildId, userId, amount });
    return amount;
  };
  smiteConfigStore.isEnabled = () => true;

  let now = 1_000;
  Date.now = () => now;

  try {
    await handler.execute(mkState(), mkState({ channelId: 'voice-1' }));
    now += 15 * 60 * 1_000;
    await handler.execute(mkState({ channelId: 'voice-1' }), mkState({ channelId: 'voice-1' }));

    assert.equal(rupeeCalls.length, 1);
    assert.deepEqual(rupeeCalls[0], { guildId: 'g1', userId: 'u1', amount: 1 });
    assert.equal(coinCalls.length, 1);
  } finally {
    Date.now = originalNow;
    coinStore.addCoins = originalAddCoins;
    rupeeStore.addTokens = originalAddTokens;
    smiteConfigStore.isEnabled = originalEnabled;
  }
});

test('does not award rupees when economy is disabled', async () => {
  const handler = loadHandler();
  const originalNow = Date.now;
  const originalAddTokens = rupeeStore.addTokens;
  const originalEnabled = smiteConfigStore.isEnabled;

  const rupeeCalls = [];
  rupeeStore.addTokens = async (...args) => {
    rupeeCalls.push(args);
    return 0;
  };
  smiteConfigStore.isEnabled = () => false;

  let now = 1_000;
  Date.now = () => now;

  try {
    await handler.execute(mkState(), mkState({ channelId: 'voice-1' }));
    now += 16 * 60 * 1_000;
    await handler.execute(mkState({ channelId: 'voice-1' }), mkState({ channelId: 'voice-1' }));

    assert.equal(rupeeCalls.length, 0);
  } finally {
    Date.now = originalNow;
    rupeeStore.addTokens = originalAddTokens;
    smiteConfigStore.isEnabled = originalEnabled;
  }
});
