const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const store = require('../utils/restrainingOrderStore');

function parseUserId(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const id = raw.replace(/[^0-9]/g, '');
  return id || null;
}

async function resolveUserTag(client, userId) {
  if (!client || !userId) return null;
  try {
    const user = await client.users.fetch(userId);
    return user?.tag || user?.username || null;
  } catch (_) {
    return null;
  }
}

function formatPair(entry) {
  const [id1, id2] = entry.userIds || [];
  const [name1, name2] = entry.users || [];
  const left = name1 ? `${name1} (${id1})` : `<@${id1}> (${id1})`;
  const right = name2 ? `${name2} (${id2})` : `<@${id2}> (${id2})`;
  return `${left} ↔ ${right}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restrainingorder')
    .setDescription('Restrict two users from mentioning or replying to each other')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a restraining order between two users')
        .addUserOption(opt =>
          opt.setName('user1').setDescription('First user').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('user1id').setDescription('First user ID').setRequired(false)
        )
        .addUserOption(opt =>
          opt.setName('user2').setDescription('Second user').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('user2id').setDescription('Second user ID').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a restraining order between two users')
        .addUserOption(opt =>
          opt.setName('user1').setDescription('First user').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('user1id').setDescription('First user ID').setRequired(false)
        )
        .addUserOption(opt =>
          opt.setName('user2').setDescription('Second user').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('user2id').setDescription('Second user ID').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List active restraining orders')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: 'I need Manage Messages to enforce restraining orders.', ephemeral: true });
    }
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: 'You need Manage Messages to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const list = await store.list(interaction.guild.id);
      if (!list.length) {
        return interaction.reply({ content: 'No active restraining orders found.', ephemeral: true });
      }
      const lines = list.map(entry => `• ${formatPair(entry)}`);
      return interaction.reply({
        content: lines.join('\n').slice(0, 1900),
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
    }

    const user1 = interaction.options.getUser('user1');
    const user2 = interaction.options.getUser('user2');
    const user1Id = user1?.id || parseUserId(interaction.options.getString('user1id'));
    const user2Id = user2?.id || parseUserId(interaction.options.getString('user2id'));

    if (!user1Id || !user2Id) {
      return interaction.reply({
        content: 'Provide both users (user options or user IDs).',
        ephemeral: true,
      });
    }

    if (user1Id === user2Id) {
      return interaction.reply({ content: 'Choose two different users.', ephemeral: true });
    }

    if (sub === 'add') {
      const [name1, name2] = await Promise.all([
        user1?.tag ? user1.tag : resolveUserTag(interaction.client, user1Id),
        user2?.tag ? user2.tag : resolveUserTag(interaction.client, user2Id),
      ]);
      const result = await store.add(interaction.guild.id, user1Id, user2Id, {
        userAName: name1,
        userBName: name2,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
      });
      const label = result.existed ? 'already exists' : 'created';
      return interaction.reply({
        content: `Restraining order ${label} between <@${user1Id}> and <@${user2Id}>.`,
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const removed = await store.remove(interaction.guild.id, user1Id, user2Id);
      if (!removed) {
        return interaction.reply({
          content: 'No restraining order found for those users.',
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: `Removed restraining order between <@${user1Id}> and <@${user2Id}>.`,
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
