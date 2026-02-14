const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { getSupportServerUrl } = require('../utils/supportServer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('View what is included with Premium'),

  async execute(interaction) {
    const supportUrl = getSupportServerUrl();
    const embed = new EmbedBuilder()
      .setTitle('Premium')
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setDescription('Premium unlocks extra bot perks for your server and members.')
      .addFields(
        {
          name: 'Includes',
          value: [
            'Unlimited `/removebg` usage in premium servers.',
            'Premium-only bot utilities and future premium feature drops.',
            'Premium access via active server boost or paid premium.',
          ].join('\n'),
          inline: false,
        },
        {
          name: 'Support Server',
          value: supportUrl,
          inline: false,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
