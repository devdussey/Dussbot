const test = require('node:test');
const assert = require('node:assert/strict');

const viewrupees = require('../src/commands/viewrupees');
const rupeeStore = require('../src/utils/rupeeStore');

function createInteraction({ isAdmin }) {
  let reply;
  const target = { id: 'target', username: 'Target' };

  return {
    inGuild: () => true,
    guildId: 'guild',
    member: {
      permissions: {
        has: () => isAdmin,
      },
    },
    options: {
      getUser: () => target,
    },
    deferReply: () => Promise.resolve(),
    reply: (data) => {
      reply = data;
      return Promise.resolve(data);
    },
    editReply: (data) => {
      reply = data;
      return Promise.resolve(data);
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

test('viewrupees shows rupee balance and progress for admins', async () => {
  const originalGetProgress = rupeeStore.getProgress;
  rupeeStore.getProgress = () => ({
    totalMessages: 1234,
    tokens: 3,
    progress: 20,
    messagesUntilNext: rupeeStore.AWARD_THRESHOLD - 20,
  });

  try {
    const interaction = createInteraction({ isAdmin: true });
    await viewrupees.execute(interaction);

    const reply = interaction.getReply();
    assert(reply, 'expected viewrupees to edit the reply');
    const embedBuilder = reply.embeds && reply.embeds[0];
    assert(embedBuilder, 'expected an embed in the viewrupees response');

    const embed = typeof embedBuilder.toJSON === 'function' ? embedBuilder.toJSON() : embedBuilder;
    assert.equal(embed.title, 'Rupee Balance');
    assert.match(embed.description, /<@target> has \*\*3\*\* rupees\./);

    const progressField = embed.fields.find(f => f.name === 'Progress');
    assert(progressField, 'expected a progress field');
    assert.match(progressField.value, new RegExp(`20\\/${rupeeStore.AWARD_THRESHOLD}`));

    const nextField = embed.fields.find(f => f.name === 'Next Rupee In');
    assert(nextField, 'expected a next field');
    assert.match(nextField.value, /\d+ messages?/);
  } finally {
    rupeeStore.getProgress = originalGetProgress;
  }
});

