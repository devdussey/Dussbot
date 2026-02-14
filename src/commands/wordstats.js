const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const wordStatsStore = require('../utils/wordStatsConfigStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const MAX_ROWS = 10;

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
}

function formatPlural(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function formatUser(entry) {
  const mention = `<@${entry.userId}>`;
  return entry.lastKnownTag ? `${mention} (${entry.lastKnownTag})` : mention;
}

function formatConfiguredChannel(guildId) {
  const config = wordStatsStore.getConfig(guildId);
  return config.trackedChannelId ? `<#${config.trackedChannelId}>` : 'Not configured';
}

function joinLines(lines, fallback = 'No data yet.', limit = 1024) {
  if (!Array.isArray(lines) || !lines.length) return fallback;
  const output = [];
  let used = 0;

  for (const line of lines) {
    const safeLine = String(line || '').trim();
    if (!safeLine) continue;
    const added = safeLine.length + (output.length ? 1 : 0);
    if (used + added > limit) {
      if (!output.length) return safeLine.slice(0, limit);
      const ellipsis = '...';
      if (used + ellipsis.length + 1 <= limit) output.push(ellipsis);
      break;
    }
    output.push(safeLine);
    used += added;
  }

  return output.length ? output.join('\n') : fallback;
}

function buildNoDataEmbed(interaction, title, description) {
  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}` })
    .setTimestamp();
}

function buildOverviewEmbed(interaction) {
  const topWords = wordStatsStore.getTopWords(interaction.guildId, MAX_ROWS);
  const topUsers = wordStatsStore.getTopUsers(interaction.guildId, MAX_ROWS);
  const hasWords = topWords.entries.length > 0;
  const hasUsers = topUsers.entries.length > 0;

  if (!hasWords && !hasUsers) {
    return buildNoDataEmbed(
      interaction,
      'Word Stats Overview',
      'No tracked data exists yet. Use `/wordstatsconfig set` and let messages accumulate, or import a backfill file.',
    );
  }

  const wordLines = topWords.entries.map((entry, index) => (
    `${index + 1}. \`${entry.word}\` - ${formatNumber(entry.totalCount)} total | top: <@${entry.topUserId}> (${formatNumber(entry.topUserCount)})`
  ));
  const userLines = topUsers.entries.map((entry, index) => (
    `${index + 1}. ${formatUser(entry)} - ${formatNumber(entry.count)} total (${formatNumber(entry.textCount)} text / ${formatNumber(entry.mediaCount)} media)`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x1abc9c))
    .setTitle('Word Stats Overview')
    .addFields(
      { name: 'Top 10 Words', value: joinLines(wordLines, 'No words recorded yet.') },
      { name: 'Top 10 Message Senders', value: joinLines(userLines, 'No tracked users yet.') },
    )
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Total tracked messages: ${formatNumber(topUsers.totals.totalMessages)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

function buildWordEmbed(interaction, normalizedWord, searchResult) {
  if (!searchResult.users.length) {
    return buildNoDataEmbed(
      interaction,
      `Word Usage: "${normalizedWord}"`,
      'No tracked users have used that word yet.',
    );
  }

  const usageLines = searchResult.users.map((entry, index) => (
    `${index + 1}. ${formatUser(entry)} - ${formatNumber(entry.count)} ${formatPlural(entry.count, 'use')}`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x3498db))
    .setTitle(`Word Usage: "${normalizedWord}"`)
    .setDescription(joinLines(usageLines))
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Total matches: ${formatNumber(searchResult.totalMatches)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

function buildMediaEmbed(interaction) {
  const topMedia = wordStatsStore.getTopMediaUsers(interaction.guildId, MAX_ROWS);
  if (!topMedia.entries.length) {
    return buildNoDataEmbed(
      interaction,
      'Media Stats',
      'No tracked media activity exists yet (images, stickers, or emojis).',
    );
  }

  const lines = topMedia.entries.map((entry, index) => (
    `${index + 1}. ${formatUser(entry)} - ${formatNumber(entry.mediaCount)} media messages | ${formatNumber(entry.mediaBreakdown.images)} images, ${formatNumber(entry.mediaBreakdown.stickers)} stickers, ${formatNumber(entry.mediaBreakdown.emojis)} emojis`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0xe67e22))
    .setTitle('Media Stats')
    .setDescription(joinLines(lines))
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Total media messages: ${formatNumber(topMedia.totals.mediaMessages)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

function buildUserEmbed(interaction, user, stats) {
  if (!stats) {
    return buildNoDataEmbed(
      interaction,
      `Word Stats for ${user.username}`,
      `No tracked data exists for <@${user.id}> yet.`,
    );
  }

  const topWordLines = stats.topWords.map((entry, index) => (
    `${index + 1}. \`${entry.word}\` - ${formatNumber(entry.count)}`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x9b59b6))
    .setTitle(`Word Stats for ${user.username}`)
    .addFields(
      {
        name: 'Message Counts',
        value: [
          `Total: ${formatNumber(stats.count)}`,
          `Text: ${formatNumber(stats.textCount)}`,
          `Media: ${formatNumber(stats.mediaCount)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Media Breakdown',
        value: [
          `Images: ${formatNumber(stats.mediaBreakdown.images)}`,
          `Stickers: ${formatNumber(stats.mediaBreakdown.stickers)}`,
          `Emojis: ${formatNumber(stats.mediaBreakdown.emojis)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Top 10 Words',
        value: joinLines(topWordLines, 'No words recorded for this user yet.'),
        inline: false,
      },
    )
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Unique words: ${formatNumber(stats.uniqueWordCount)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordstats')
    .setDescription('View tracked word and message statistics')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('overview')
        .setDescription('View top words and top message senders'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('word')
        .setDescription('Search a specific word and view the top users for it')
        .addStringOption((option) =>
          option
            .setName('word')
            .setDescription('Word to search')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('media')
        .setDescription('See who posts the most media (images, stickers, emojis)'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('user')
        .setDescription('View top words and message totals for one user')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to inspect')
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand(false) || 'overview';

    if (subcommand === 'overview') {
      const embed = buildOverviewEmbed(interaction);
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'word') {
      const rawWord = interaction.options.getString('word', true);
      const normalizedWord = wordStatsStore.normalizeWordToken(rawWord);
      if (!normalizedWord) {
        return interaction.reply({ content: 'Please provide a valid word to search.', ephemeral: true });
      }

      const result = wordStatsStore.searchWordUsage(interaction.guildId, normalizedWord, MAX_ROWS);
      const embed = buildWordEmbed(interaction, normalizedWord, result);
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'media') {
      const embed = buildMediaEmbed(interaction);
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'user') {
      const user = interaction.options.getUser('user', true);
      const stats = wordStatsStore.getUserWordStats(interaction.guildId, user.id, MAX_ROWS);
      const embed = buildUserEmbed(interaction, user, stats);
      return interaction.reply({ embeds: [embed] });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
