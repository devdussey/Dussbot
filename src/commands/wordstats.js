const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const wordStatsStore = require('../utils/wordStatsConfigStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const OVERVIEW_ROWS = 10;
const FULL_VIEW_LIMIT = 100;
const PAGE_SIZE = 10;
const MIN_WORD_LENGTH = 4;
const USER_SEARCH_TOP_WORDS = 20;
const PAGER_TIMEOUT_MS = 180_000;

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

function formatDiscordTimestamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'Unknown';
  return `<t:${Math.floor(ms / 1000)}:f>`;
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
  const topWords = wordStatsStore.getTopWords(interaction.guildId, OVERVIEW_ROWS, { minWordLength: MIN_WORD_LENGTH });
  const topUsers = wordStatsStore.getTopUsers(interaction.guildId, OVERVIEW_ROWS);
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

  const messageLines = topUsers.entries.map((entry, index) => (
    `${index + 1}. ${formatUser(entry)} - ${formatNumber(entry.count)} ${formatPlural(entry.count, 'message')}`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x1abc9c))
    .setTitle('Word Stats Overview')
    .addFields(
      { name: 'Top 10 Words (4+ letters)', value: joinLines(wordLines, 'No 4+ letter words recorded yet.') },
      { name: 'Top 10 Message Senders', value: joinLines(messageLines, 'No tracked users yet.') },
    )
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Total tracked messages: ${formatNumber(topUsers.totals.totalMessages)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

function buildWordSearchEmbed(interaction, normalizedWord, searchResult) {
  if (!searchResult.users.length) {
    return buildNoDataEmbed(
      interaction,
      `Word Search: "${normalizedWord}"`,
      'No tracked users have used that word yet.',
    );
  }

  const topUser = searchResult.users[0];
  const topUsersLines = searchResult.users.map((entry, index) => (
    `${index + 1}. ${formatUser(entry)} - ${formatNumber(entry.count)} ${formatPlural(entry.count, 'use')}`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x3498db))
    .setTitle(`Word Search: "${normalizedWord}"`)
    .addFields(
      {
        name: 'Summary',
        value: [
          `Most used by: ${formatUser(topUser)} (${formatNumber(topUser.count)})`,
          `Total uses: ${formatNumber(searchResult.totalMatches)}`,
          `Users who used it: ${formatNumber(searchResult.userCount)}`,
        ].join('\n'),
      },
      {
        name: `Top ${formatNumber(searchResult.users.length)} Users`,
        value: joinLines(topUsersLines, 'No data yet.'),
      },
    )
    .setFooter({
      text: `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
    })
    .setTimestamp();
}

function buildTopWordFields(topWords) {
  if (!Array.isArray(topWords) || !topWords.length) {
    return [
      {
        name: 'Top Words',
        value: 'No words recorded for this user yet.',
        inline: false,
      },
    ];
  }

  const firstTen = topWords.slice(0, 10).map((entry, index) => (
    `${index + 1}. \`${entry.word}\` (${formatNumber(entry.count)})`
  ));

  const fields = [
    {
      name: `Top ${Math.min(10, topWords.length)} Words`,
      value: joinLines(firstTen, 'No data yet.'),
      inline: false,
    },
  ];

  if (topWords.length > 10) {
    const nextTen = topWords.slice(10, 20).map((entry, index) => (
      `${index + 11}. \`${entry.word}\` (${formatNumber(entry.count)})`
    ));
    fields.push({
      name: `Top ${Math.min(20, topWords.length)} Words`,
      value: joinLines(nextTen, 'No additional words.'),
      inline: false,
    });
  }

  return fields;
}

function buildUserSearchEmbed(interaction, user, stats) {
  if (!stats) {
    return buildNoDataEmbed(
      interaction,
      `User Word Stats: ${user.username}`,
      `No tracked data exists for <@${user.id}> yet.`,
    );
  }

  const mostUsedWord = stats.topWords?.[0] || null;
  const mostUsedWordText = mostUsedWord
    ? `\`${mostUsedWord.word}\` (${formatNumber(mostUsedWord.count)} ${formatPlural(mostUsedWord.count, 'use')})`
    : 'No tracked words yet.';
  const topWordFields = buildTopWordFields(stats.topWords);

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x9b59b6))
    .setTitle(`User Word Stats: ${user.username}`)
    .addFields(
      {
        name: 'Most Used Word',
        value: mostUsedWordText,
        inline: false,
      },
      {
        name: 'Message Totals',
        value: [
          `Total messages: ${formatNumber(stats.count)}`,
          `Text messages: ${formatNumber(stats.textCount)}`,
          `Media messages: ${formatNumber(stats.mediaCount)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Vocabulary',
        value: [
          `Unique words: ${formatNumber(stats.uniqueWordCount)}`,
          `Total word uses: ${formatNumber(stats.totalWordUses)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Message Dates',
        value: [
          `First tracked: ${formatDiscordTimestamp(stats.firstMessageAt)}`,
          `Last tracked: ${formatDiscordTimestamp(stats.lastMessageAt)}`,
        ].join('\n'),
        inline: false,
      },
      ...topWordFields,
    )
    .setFooter({
      text: `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
    })
    .setTimestamp();
}

function buildWordsViewEmbed(interaction, topWords, page, pageCount) {
  const start = page * PAGE_SIZE;
  const pageEntries = topWords.entries.slice(start, start + PAGE_SIZE);
  const lines = pageEntries.map((entry, index) => (
    `${start + index + 1}. \`${entry.word}\` - ${formatNumber(entry.totalCount)} total | top: <@${entry.topUserId}> (${formatNumber(entry.topUserCount)})`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x1abc9c))
    .setTitle('Top Word Stats')
    .setDescription(`Top ${formatNumber(topWords.entries.length)} words with ${MIN_WORD_LENGTH}+ letters.`)
    .addFields(
      { name: 'Words', value: joinLines(lines, 'No words recorded yet.') },
    )
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Page ${page + 1}/${pageCount}`,
        `Total uses: ${formatNumber(topWords.totalWordUses)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

function buildMessagesViewEmbed(interaction, topUsers, page, pageCount) {
  const start = page * PAGE_SIZE;
  const pageEntries = topUsers.entries.slice(start, start + PAGE_SIZE);
  const lines = pageEntries.map((entry, index) => (
    `${start + index + 1}. ${formatUser(entry)} - ${formatNumber(entry.count)} ${formatPlural(entry.count, 'message')}`
  ));

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0xf39c12))
    .setTitle('Top Message Stats')
    .setDescription(`Top ${formatNumber(topUsers.entries.length)} users by tracked messages.`)
    .addFields(
      { name: 'Message Leaders', value: joinLines(lines, 'No tracked users yet.') },
    )
    .setFooter({
      text: [
        `Tracked channel: ${formatConfiguredChannel(interaction.guildId)}`,
        `Page ${page + 1}/${pageCount}`,
        `Total tracked messages: ${formatNumber(topUsers.totals.totalMessages)}`,
      ].join(' | '),
    })
    .setTimestamp();
}

function buildPagerComponents(baseId, page, pageCount, disableAll = false) {
  if (pageCount <= 1) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${baseId}:prev`)
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disableAll || page <= 0),
      new ButtonBuilder()
        .setCustomId(`${baseId}:next`)
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disableAll || page >= pageCount - 1),
    ),
  ];
}

async function runPagedReply(interaction, baseId, pageCount, buildPageEmbed) {
  let page = 0;
  await interaction.reply({
    embeds: [buildPageEmbed(page)],
    components: buildPagerComponents(baseId, page, pageCount),
  });

  if (pageCount <= 1) return;

  const message = await interaction.fetchReply();
  const prevId = `${baseId}:prev`;
  const nextId = `${baseId}:next`;

  const collector = message.createMessageComponentCollector({
    time: PAGER_TIMEOUT_MS,
    filter: (componentInteraction) => (
      componentInteraction.customId === prevId || componentInteraction.customId === nextId
    ),
  });

  collector.on('collect', async (componentInteraction) => {
    if (componentInteraction.customId === prevId && page > 0) {
      page -= 1;
    } else if (componentInteraction.customId === nextId && page < pageCount - 1) {
      page += 1;
    }

    try {
      await componentInteraction.update({
        embeds: [buildPageEmbed(page)],
        components: buildPagerComponents(baseId, page, pageCount),
      });
    } catch (_) {}
  });

  collector.on('end', async () => {
    try {
      await message.edit({
        components: buildPagerComponents(baseId, page, pageCount, true),
      });
    } catch (_) {}
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordstats')
    .setDescription('View tracked word and message statistics')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('view')
        .setDescription('View a leaderboard list')
        .addChoices(
          { name: 'words', value: 'words' },
          { name: 'messages', value: 'messages' },
        )
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('search')
        .setDescription('Search for a word or a user')
        .addChoices(
          { name: 'word', value: 'word' },
          { name: 'user', value: 'user' },
        )
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('word')
        .setDescription('Word to search (used for search:word)')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('User to inspect (used for search:user)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const requestedView = interaction.options.getString('view');
    const requestedSearch = interaction.options.getString('search');
    const rawWord = interaction.options.getString('word');
    const requestedUser = interaction.options.getUser('user');

    if (requestedView && requestedSearch) {
      return interaction.reply({ content: 'Use either `view` or `search`, not both in one command.', ephemeral: true });
    }

    if (requestedView) {
      if (rawWord || requestedUser) {
        return interaction.reply({ content: 'The `view` option only accepts `words` or `messages`.', ephemeral: true });
      }

      if (requestedView === 'words') {
        const topWords = wordStatsStore.getTopWords(interaction.guildId, FULL_VIEW_LIMIT, { minWordLength: MIN_WORD_LENGTH });
        if (!topWords.entries.length) {
          const embed = buildNoDataEmbed(
            interaction,
            'Top Word Stats',
            `No ${MIN_WORD_LENGTH}+ letter words have been tracked yet.`,
          );
          return interaction.reply({ embeds: [embed] });
        }

        const pageCount = Math.ceil(topWords.entries.length / PAGE_SIZE);
        const baseId = `wordstats:words:${interaction.id}`;
        return runPagedReply(
          interaction,
          baseId,
          pageCount,
          (page) => buildWordsViewEmbed(interaction, topWords, page, pageCount),
        );
      }

      if (requestedView === 'messages') {
        const topUsers = wordStatsStore.getTopUsers(interaction.guildId, FULL_VIEW_LIMIT);
        if (!topUsers.entries.length) {
          const embed = buildNoDataEmbed(
            interaction,
            'Top Message Stats',
            'No tracked users exist yet.',
          );
          return interaction.reply({ embeds: [embed] });
        }

        const pageCount = Math.ceil(topUsers.entries.length / PAGE_SIZE);
        const baseId = `wordstats:messages:${interaction.id}`;
        return runPagedReply(
          interaction,
          baseId,
          pageCount,
          (page) => buildMessagesViewEmbed(interaction, topUsers, page, pageCount),
        );
      }

      return interaction.reply({ content: 'Unknown view option.', ephemeral: true });
    }

    let searchMode = requestedSearch;
    if (!searchMode) {
      if (rawWord && requestedUser) {
        return interaction.reply({ content: 'Choose either a word search or a user search, not both.', ephemeral: true });
      }
      if (rawWord) searchMode = 'word';
      else if (requestedUser) searchMode = 'user';
    }

    if (searchMode === 'word') {
      if (requestedUser) {
        return interaction.reply({ content: 'User input is only valid for `search:user`.', ephemeral: true });
      }
      if (!rawWord) {
        return interaction.reply({ content: 'Provide a word. Example: `/wordstats search:word word:hello`.', ephemeral: true });
      }
      const normalizedWord = wordStatsStore.normalizeWordToken(rawWord);
      if (!normalizedWord) {
        return interaction.reply({ content: 'Please provide a valid word to search.', ephemeral: true });
      }

      const result = wordStatsStore.searchWordUsage(interaction.guildId, normalizedWord, OVERVIEW_ROWS);
      const embed = buildWordSearchEmbed(interaction, normalizedWord, result);
      return interaction.reply({ embeds: [embed] });
    }

    if (searchMode === 'user') {
      if (rawWord) {
        return interaction.reply({ content: 'Word input is only valid for `search:word`.', ephemeral: true });
      }
      if (!requestedUser) {
        return interaction.reply({ content: 'Provide a user. Example: `/wordstats search:user user:@member`.', ephemeral: true });
      }

      const stats = wordStatsStore.getUserWordStats(interaction.guildId, requestedUser.id, USER_SEARCH_TOP_WORDS);
      const embed = buildUserSearchEmbed(interaction, requestedUser, stats);
      return interaction.reply({ embeds: [embed] });
    }

    if (requestedSearch) {
      return interaction.reply({ content: 'Unknown search option.', ephemeral: true });
    }

    const embed = buildOverviewEmbed(interaction);
    return interaction.reply({ embeds: [embed] });
  },
};
