const test = require('node:test');
const assert = require('node:assert/strict');

const balance = require('../src/commands/currencybalances');
const rupeeStore = require('../src/utils/rupeeStore');

function createInteraction({ subcommand = 'leaderboard', targetUser = null } = {}) {
  let reply;
  return {
    inGuild: () => true,
    guildId: 'guild',
    id: 'interaction-id',
    guild: {
      members: {
        cache: new Map(),
        fetch: () => Promise.resolve(null),
      },
    },
    user: { id: 'user', username: 'Tester' },
    options: {
      getSubcommand: () => subcommand,
      getUser: () => targetUser,
    },
    deferReply: () => Promise.resolve(),
    reply: (data) => {
      reply = data;
      return Promise.resolve(data);
    },
    editReply: (data) => {
      reply = data;
      return Promise.resolve({
        ...data,
        createMessageComponentCollector: () => ({
          on: () => {},
        }),
      });
    },
    getReply: () => reply,
  };
}

test('balance personal shows caller balance and rank', async () => {
  const originalRupeeBalance = rupeeStore.getBalance;
  const originalList = rupeeStore.listUserBalances;

  rupeeStore.getBalance = () => 5;
  rupeeStore.listUserBalances = () => ([
    { userId: 'user', tokens: 5 },
    { userId: 'u2', tokens: 2 },
  ]);

  try {
    const interaction = createInteraction({ subcommand: 'personal' });
    await balance.execute(interaction);

    const reply = interaction.getReply();
    assert(reply, 'expected balance command to reply');

    const embedBuilder = reply.embeds && reply.embeds[0];
    assert(embedBuilder, 'expected an embed in the balance response');

    const embed = typeof embedBuilder.toJSON === 'function' ? embedBuilder.toJSON() : embedBuilder;

    assert.match(embed.title, /Rupee Balance/);
    assert.match(embed.description, /<@user> currently has \*\*5 rupees\*\*/);

    const rankField = embed.fields.find((field) => field.name === 'Leaderboard Rank');
    assert(rankField, 'expected leaderboard rank field');
    assert.match(rankField.value, /#1 of 2/);
  } finally {
    rupeeStore.getBalance = originalRupeeBalance;
    rupeeStore.listUserBalances = originalList;
  }
});

test('balance user shows unranked users with zero balance', async () => {
  const originalRupeeBalance = rupeeStore.getBalance;
  const originalList = rupeeStore.listUserBalances;

  rupeeStore.getBalance = (_guildId, userId) => (userId === 'target' ? 0 : 3);
  rupeeStore.listUserBalances = () => ([
    { userId: 'user', tokens: 3 },
  ]);

  try {
    const interaction = createInteraction({
      subcommand: 'user',
      targetUser: { id: 'target', username: 'Target' },
    });
    await balance.execute(interaction);

    const reply = interaction.getReply();
    assert(reply, 'expected balance command to reply');

    const embedBuilder = reply.embeds && reply.embeds[0];
    const embed = typeof embedBuilder.toJSON === 'function' ? embedBuilder.toJSON() : embedBuilder;

    assert.match(embed.description, /<@target> currently has \*\*0 rupees\*\*/);
    const rankField = embed.fields.find((field) => field.name === 'Leaderboard Rank');
    assert(rankField, 'expected leaderboard rank field');
    assert.match(rankField.value, /Unranked/);
  } finally {
    rupeeStore.getBalance = originalRupeeBalance;
    rupeeStore.listUserBalances = originalList;
  }
});

test('balance leaderboard renders leaderboard view', async () => {
  const originalList = rupeeStore.listUserBalances;

  rupeeStore.listUserBalances = () => ([
    { userId: 'u2', tokens: 5 },
    { userId: 'u1', tokens: 2 },
  ]);

  try {
    const interaction = createInteraction({ subcommand: 'leaderboard' });
    await balance.execute(interaction);

    const reply = interaction.getReply();
    assert(reply, 'expected balance command to edit reply for leaderboard');
    const embedBuilder = reply.embeds && reply.embeds[0];
    const embed = typeof embedBuilder.toJSON === 'function' ? embedBuilder.toJSON() : embedBuilder;
    assert.match(embed.title, /Rupee Leaderboard/);
    const leaderboardField = embed.fields.find((field) => field.name === 'Leaderboard');
    assert(leaderboardField, 'expected leaderboard field');
    assert.match(leaderboardField.value, /1\. <@u2>/);
  } finally {
    rupeeStore.listUserBalances = originalList;
  }
});
