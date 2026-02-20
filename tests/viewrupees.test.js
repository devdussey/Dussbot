const test = require('node:test');
const assert = require('node:assert/strict');

const viewrupees = require('../src/commands/viewrupees');
const rupeeStore = require('../src/utils/rupeeStore');

function createInteraction({ isAdmin }) {
  let reply;
  return {
    inGuild: () => true,
    guildId: 'guild',
    member: {
      permissions: {
        has: () => isAdmin,
      },
    },
    deferReply: () => Promise.resolve(),
    reply: (data) => {
      reply = data;
      return Promise.resolve(data);
    },
    editReply: (data) => {
      reply = data;
      // mimic discord.js returning a Message-like object for component collectors
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

test('viewrupees denies non-admins', async () => {
  const interaction = createInteraction({ isAdmin: false });
  await viewrupees.execute(interaction);
  const reply = interaction.getReply();
  assert.equal(reply.content, 'Only server administrators can use this command.');
});

test('viewrupees shows rupee leaderboard for admins', async () => {
  const originalList = rupeeStore.listUserBalances;
  rupeeStore.listUserBalances = () => ([
    { userId: 'u2', tokens: 5 },
    { userId: 'u1', tokens: 2 },
  ]);

  try {
    const interaction = createInteraction({ isAdmin: true });
    await viewrupees.execute(interaction);

    const reply = interaction.getReply();
    assert(reply, 'expected viewrupees to edit the reply');
    const embedBuilder = reply.embeds && reply.embeds[0];
    assert(embedBuilder, 'expected an embed in the viewrupees response');

    const embed = typeof embedBuilder.toJSON === 'function' ? embedBuilder.toJSON() : embedBuilder;
    assert.equal(embed.title, 'Rupee Balances');
    assert.match(embed.description, /Users with rupees: \*\*2\*\*/);

    const leaderboardField = embed.fields.find(f => f.name === 'Leaderboard');
    assert(leaderboardField, 'expected leaderboard field');
    assert.match(leaderboardField.value, /1\. <@u2> — \*\*5 rupees\*\*/);
    assert.match(leaderboardField.value, /2\. <@u1> — \*\*2 rupees\*\*/);
  } finally {
    rupeeStore.listUserBalances = originalList;
  }
});

test('viewrupees shows pager when more than 20 users have rupees', async () => {
  const originalList = rupeeStore.listUserBalances;
  rupeeStore.listUserBalances = () => Array.from({ length: 21 }, (_, i) => ({
    userId: `u${i + 1}`,
    tokens: 1,
  }));

  try {
    const interaction = createInteraction({ isAdmin: true });
    await viewrupees.execute(interaction);
    const reply = interaction.getReply();
    assert(reply.components?.length, 'expected pager components');
  } finally {
    rupeeStore.listUserBalances = originalList;
  }
});
