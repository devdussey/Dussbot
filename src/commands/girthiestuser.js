const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const messageCountStore = require('../utils/messageCountStore');

const DEFAULT_LIMIT = 10;
const COLOR = 0xff6a00;

function formatLeaderboardEntry(entry, rank) {
  const mention = `<@${entry.userId}>`;
  const tagFragment = entry.lastKnownTag ? ` (${entry.lastKnownTag})` : '';
  const countText = `${entry.count.toLocaleString()} message${entry.count === 1 ? '' : 's'}`;
  return `${rank}. ${mention} — ${countText}${tagFragment}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('girthiestuser')
    .setDescription('Show the members whose messages are logged most often')
    .addIntegerOption((option) => option
      .setName('limit')
      .setDescription('How many top users to show (max 25)')
      .setMinValue(1)
      .setMaxValue(messageCountStore.MAX_LEADERBOARD_ENTRIES)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command is only available inside servers.', ephemeral: true });
    }

    const requestedLimit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
    const { entries, totalMessages, limit } = messageCountStore.getLeaderboard(interaction.guildId, { limit: requestedLimit });

    if (!entries.length) {
      return interaction.reply({
        content: 'No message data has been captured yet. Send some messages and try again.',
        ephemeral: true,
      });
    }

    const description = entries
      .map((entry, index) => formatLeaderboardEntry(entry, index + 1))
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Girthiest Users')
      .setColor(resolveEmbedColour(interaction.guildId, COLOR))
      .setDescription(description)
      .addFields(
        { name: 'Tracked Messages', value: `${totalMessages.toLocaleString()}`, inline: true },
        { name: 'Showing Top', value: `${entries.length} of ${limit}`, inline: true },
      )
      .setFooter({ text: 'Counts are cumulative across tracked history.' });

    try {
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      if (interaction.channel?.send) {
        await interaction.channel.send({ embeds: [embed] });
      } else {
        console.error('Failed to send girthiestuser response', err);
      }
    }
  },
};
