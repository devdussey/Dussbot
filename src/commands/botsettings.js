const { SlashCommandBuilder } = require('discord.js');
const { shouldReplyEphemeral } = require('../utils/botConfigStore');
const { buildBotSettingsView } = require('../utils/botSettingsView');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botsettings')
    .setDescription('View the bot settings and defaults for this server'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const view = buildBotSettingsView(interaction.guild || null);
    const ephemeral = shouldReplyEphemeral(guildId, 'utility', true);
    return interaction.reply({ embeds: [view.embed], components: view.components, ephemeral });
  },
};
