import path from 'node:path';
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const messageLogStore = requireFromSrcIfNeeded('../utils/userMessageLogStore');

const embedColor = 0x00f9ff;
const maxRows = 10;

function sanitizeWord(word: string) {
  return (word || '').trim().slice(0, 64);
}

function formatUsageLines(results: Array<{ authorTag?: string; userId: string; count: number }>) {
  return results.map((entry, index) => {
    const position = index + 1;
    const label = entry.authorTag || `<@${entry.userId}>`;
    const plural = entry.count === 1 ? '' : 's';
    return `${position}. ${label} (${entry.userId}) — ${entry.count} use${plural}`;
  });
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('searchword')
    .setDescription('Find who has used a word most often in the stored messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('word')
      .setDescription('Word to search for (case-insensitive, whole word match)')
      .setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    const rawWord = interaction.options.getString('word', true);
    const word = sanitizeWord(rawWord);
    if (!word) {
      return interaction.reply({ content: 'Please provide a word to search for.', ephemeral: true });
    }

    try {
      await interaction.deferReply();
    } catch (_) {}

    const result = messageLogStore.searchWordUsage(interaction.guildId, word);
    if (!result.users.length) {
      const embed = new EmbedBuilder()
        .setTitle(`No matches for "${word}"`)
        .setColor(embedColor)
        .setDescription('No stored messages contain that word yet.')
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    const topResults = result.users.slice(0, maxRows);
    const lines = formatUsageLines(topResults);
    const additionalCount = result.users.length - topResults.length;

    const embed = new EmbedBuilder()
      .setTitle(`Word usage for "${word}"`)
      .setColor(embedColor)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: [
          `Total matches: ${result.totalMatches}`,
          `Users with matches: ${result.users.length}`,
          additionalCount > 0 ? `${additionalCount} more user(s) not shown` : null,
        ].filter(Boolean).join(' • '),
      })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};

export = command;
