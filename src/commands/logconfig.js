const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { buildLogConfigView } = require('../utils/logConfigView');
const { isCategoryEnabled, shouldReplyEphemeral, areRepliesPublic } = require('../utils/botConfigStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logconfig')
    .setDescription('Configure where each log event is sent'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    const member = interaction.member;
    if (!member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure logging.', ephemeral: true });
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
      const view = await buildLogConfigView(guild, null, {
        category: 'Message',
        note: 'Tip: set broad “All … Events” routes first, then override specific events.',
      });
      await interaction.editReply({ embeds: [view.embed], components: view.components });
    } catch (err) {
      console.error('Failed to build logging configuration view:', err);
      await interaction.editReply({ content: 'Failed to open the logging configuration. Please try again later.' });
    }
  },
};
