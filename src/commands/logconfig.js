const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { buildLogConfigView } = require('../utils/logConfigView');
const { isCategoryEnabled, shouldReplyEphemeral, areRepliesPublic } = require('../utils/botConfigStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logconfig')
    .setDescription('Configure logging channels for message, user, invite, rupee, and antinuke events')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    const member = interaction.member;
    if (!member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to configure logging.', ephemeral: true });
    }

    if (!isCategoryEnabled(interaction.guildId, 'logging', true)) {
      const ephemeral = shouldReplyEphemeral(interaction.guildId, 'logging', true);
      return interaction.reply({ content: 'Logging commands are disabled by a server admin.', ephemeral });
    }

    const preferPublic = areRepliesPublic(interaction.guildId, 'logging', false);
    const ephemeral = !preferPublic;

    await interaction.deferReply({ ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply({ content: 'Could not resolve this server. Please try again.' });
    }

    try {
      const view = await buildLogConfigView(guild, null);
      await interaction.editReply({ embeds: [view.embed], components: view.components });
    } catch (err) {
      console.error('Failed to build logging configuration view:', err);
      await interaction.editReply({ content: 'Failed to open the logging configuration. Please try again later.' });
    }
  },
};
