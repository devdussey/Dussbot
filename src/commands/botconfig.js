const cmdLogger = require('../utils/logger')('botconfig');
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { buildBotConfigView } = require('../utils/botConfigView');
const { shouldReplyEphemeral } = require('../utils/botConfigStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botconfig')
    .setDescription('Configure bot categories (enable/disable) and reply visibility'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    const member = interaction.member;
    if (!member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure the bot.', ephemeral: true });
    }

    const ephemeral = shouldReplyEphemeral(interaction.guildId, 'utility', true);
    await interaction.deferReply({ ephemeral }).catch(() => {});

    try {
      const view = await buildBotConfigView(interaction.guild, null);
      await interaction.editReply({ embeds: [view.embed], components: view.components });
    } catch (err) {
      cmdLogger.error('Failed to build bot configuration view:', err);
      await interaction.editReply({ content: 'Failed to open the bot configuration. Please try again later.' });
    }
  },
};

