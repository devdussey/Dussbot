const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const {
    getWordLeaderboard,
    getWordDetails,
    getUserLeaderboard,
    getGuildSummary,
    recordMessage,
    flushStore,
    clearGuildStats,
    MAX_WORD_LEADERBOARD,
    MAX_USER_LEADERBOARD,
} = require('../utils/wordStatsStore');

const DEFAULT_WORD_LIMIT = 20;
const DEFAULT_LEADERBOARD_LIMIT = 10;
const DEFAULT_BACKFILL_PER_CHANNEL = 1000;
const MAX_BACKFILL_PER_CHANNEL = 3000;
const DEFAULT_SYNC_CONCURRENCY = 1;
const MAX_SYNC_CONCURRENCY = 5;
const FETCH_BATCH_SIZE = 100;
const PROGRESS_UPDATE_INTERVAL_MS = 2500;

const numberFormatter = new Intl.NumberFormat('en-US');

function clampPositiveInt(value, min, max, fallback) {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    const normalized = Math.trunc(value);
    if (normalized < min) return min;
    if (normalized > max) return max;
    return normalized;
}

function formatNumber(value) {
    const normalized = Number.isFinite(value) ? Math.trunc(value) : 0;
    return numberFormatter.format(Math.max(normalized, 0));
}

function describeLimit(limit) {
    if (!Number.isFinite(limit)) return 'full history';
    return formatNumber(limit);
}

function buildSyncProgressLine(completedChannels, totalChannels, messageCount, activeLabel = null) {
    const activeSuffix = activeLabel ? ` (active: ${activeLabel})` : '';
    return `Scanning ${formatNumber(completedChannels)}/${formatNumber(totalChannels)} channels${activeSuffix} - ${formatNumber(messageCount)} messages recorded so far...`;
}

function buildCodeBlock(lines) {
    if (!lines.length) {
        return ['```', '*(none)*', '```'].join('\n');
    }
    return ['```', ...lines, '```'].join('\n');
}

function formatUserLabel(entry) {
    return entry.lastKnownTag ? `${entry.lastKnownTag} (${entry.userId})` : entry.userId;
}

function buildWordLine(entry, index) {
    const topUser = entry.topUsers?.[0];
    const userText = topUser ? `${topUser.lastKnownTag || topUser.userId} ${formatNumber(topUser.count)}` : 'n/a';
    return `${index + 1}. ${formatNumber(entry.count)} ${entry.word} (top: ${userText})`;
}

function buildLeaderboardLine(entry, index, metricField, metricLabel) {
    const label = formatUserLabel(entry);
    return `${index + 1}. ${formatNumber(entry[metricField])} ${metricLabel} - ${label}`;
}

function formatSyncDate(timestampMs) {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 'n/a';
    const iso = new Date(timestampMs).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    const unixSeconds = Math.floor(timestampMs / 1000);
    return `${iso} (<t:${unixSeconds}:R>)`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordstats')
        .setDescription('View word usage and messaging stats for this server.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('words')
                .setDescription('Display the most frequently used words.')
                .addIntegerOption(option =>
                    option
                        .setName('limit')
                        .setDescription('How many words to return (max 30).')
                        .setMinValue(1)
                        .setMaxValue(30),
                )
                .addStringOption(option =>
                    option
                        .setName('word')
                        .setDescription('Show stats for a specific word.')
                        .setMinLength(1),
                ),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('Show the members with the highest word or message totals.')
                .addIntegerOption(option =>
                    option
                        .setName('limit')
                        .setDescription(`How many members to show (max ${MAX_USER_LEADERBOARD}).`)
                        .setMinValue(1)
                        .setMaxValue(MAX_USER_LEADERBOARD),
                )
                .addStringOption(option =>
                    option
                        .setName('metric')
                        .setDescription('Choose whether to rank by word or message totals.')
                        .addChoices(
                            { name: 'Words', value: 'words' },
                            { name: 'Messages', value: 'messages' },
                        ),
                ),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('sync')
                .setDescription('Scan recent message history to build or refresh the stats (Manage Server required).')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Optional channel to focus the scan on.'),
                )
                .addIntegerOption(option =>
                    option
                        .setName('messages')
                        .setDescription(
                            `Max messages to read per channel (default ${DEFAULT_BACKFILL_PER_CHANNEL}, max ${MAX_BACKFILL_PER_CHANNEL}, 0 for full history).`,
                        )
                        .setMinValue(0)
                        .setMaxValue(MAX_BACKFILL_PER_CHANNEL),
                )
                .addIntegerOption(option =>
                    option
                        .setName('concurrency')
                        .setDescription(
                            `How many channels to scan in parallel (default ${DEFAULT_SYNC_CONCURRENCY}, max ${MAX_SYNC_CONCURRENCY}).`,
                        )
                        .setMinValue(1)
                        .setMaxValue(MAX_SYNC_CONCURRENCY),
                ),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clean')
                .setDescription('Clear existing word stats for this server so sync can rebuild from scratch (Manage Server required).'),
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command must be used inside a server.', ephemeral: true });
        }
        if (subcommand === 'words') {
            return handleWords(interaction);
        }
        if (subcommand === 'leaderboard') {
            return handleLeaderboard(interaction);
        }
        if (subcommand === 'sync') {
            return handleSync(interaction);
        }
        if (subcommand === 'clean') {
            return handleClean(interaction);
        }
        return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    },
};

async function handleWords(interaction) {
    const requestedWord = interaction.options.getString('word');
    if (requestedWord) {
        return handleWordDetail(interaction, requestedWord);
    }
    const limit = clampPositiveInt(
        interaction.options.getInteger('limit'),
        1,
        Math.min(MAX_WORD_LEADERBOARD, 30),
        DEFAULT_WORD_LIMIT,
    );
    const stats = getWordLeaderboard(interaction.guildId, { limit, topUsers: 2 });
    if (!stats.entries.length) {
        return interaction.reply({ content: 'No word usage has been recorded yet.', ephemeral: true });
    }
    const header = `Out of ${formatNumber(stats.totalWords)} words and ${formatNumber(stats.uniqueWords)} unique words, the ${stats.entries.length} most common words are:`;
    const lines = stats.entries.map(buildWordLine);
    return interaction.reply({ content: `${header}\n${buildCodeBlock(lines)}` });
}

async function handleWordDetail(interaction, rawWord) {
    const requestedLabel = String(rawWord ?? '').trim();
    const displayRequest = requestedLabel || 'that word';
    const detail = getWordDetails(interaction.guildId, rawWord);
    if (!detail) {
        return interaction.reply({
            content: `I couldn't interpret ${displayRequest} as a tracked word.`,
            ephemeral: true,
        });
    }
    if (!detail.count) {
        return interaction.reply({
            content: `No uses of “${detail.word}” have been recorded yet.`,
            ephemeral: true,
        });
    }
    const normalized = detail.word;
    const header =
        requestedLabel && requestedLabel !== normalized
            ? `Word stats for “${requestedLabel}” (normalized to “${normalized}”):`
            : `Word stats for “${normalized}”:`;
    const topUser = detail.topUsers?.[0];
    const lines = [
        header,
        `• Total uses: ${formatNumber(detail.count)}`,
        topUser
            ? `• Most frequent user: ${formatUserLabel(topUser)} (${formatNumber(topUser.count)} uses)`
            : '• Most frequent user: n/a',
    ];
    return interaction.reply({ content: buildCodeBlock(lines) });
}

async function handleLeaderboard(interaction) {
    const limit = clampPositiveInt(
        interaction.options.getInteger('limit'),
        1,
        MAX_USER_LEADERBOARD,
        DEFAULT_LEADERBOARD_LIMIT,
    );
    const metricChoice = interaction.options.getString('metric') === 'messages' ? 'messages' : 'words';
    const board = getUserLeaderboard(interaction.guildId, { limit, metric: metricChoice });
    if (!board.entries.length) {
        return interaction.reply({ content: 'No chat activity has been recorded yet.', ephemeral: true });
    }
    const summary = getGuildSummary(interaction.guildId);
    const header =
        metricChoice === 'messages'
            ? `Out of ${formatNumber(board.totalMessages)} messages, the ${board.entries.length} most prolific members are:`
            : `Out of ${formatNumber(summary.totalWords)} words, the ${board.entries.length} most prolific members are:`;
    const metricField = metricChoice === 'messages' ? 'messageCount' : 'wordCount';
    const metricLabel = metricChoice === 'messages' ? 'messages' : 'words';
    const lines = board.entries.map((entry, index) => buildLeaderboardLine(entry, index, metricField, metricLabel));
    return interaction.reply({ content: `${header}\n${buildCodeBlock(lines)}` });
}

async function handleClean(interaction) {
    const hasPermission = interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    if (!hasPermission) {
        return interaction.reply({ content: 'Manage Server permission is required to run this cleanup.', ephemeral: true });
    }
    await clearGuildStats(interaction.guildId);
    return interaction.reply({
        content:
            'Word stats for this server were cleared. Run `/wordstats sync` to rebuild history and continue with dedupe protection.',
        ephemeral: true,
    });
}

async function handleSync(interaction) {
    const hasPermission = interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    if (!hasPermission) {
        return interaction.reply({ content: 'Manage Server permission is required to run this sync.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const requestedMessages = interaction.options.getInteger('messages');
    const concurrency = clampPositiveInt(
        interaction.options.getInteger('concurrency'),
        1,
        MAX_SYNC_CONCURRENCY,
        DEFAULT_SYNC_CONCURRENCY,
    );
    let perChannelLimit;
    if (requestedMessages === null) {
        perChannelLimit = DEFAULT_BACKFILL_PER_CHANNEL;
    } else if (requestedMessages <= 0) {
        perChannelLimit = Infinity;
    } else {
        perChannelLimit = clampPositiveInt(requestedMessages, 1, MAX_BACKFILL_PER_CHANNEL, DEFAULT_BACKFILL_PER_CHANNEL);
    }
    const requestedChannel = interaction.options.getChannel('channel');
    const guild = interaction.guild;
    const me = guild.members.me;
    if (!me) {
        return interaction.editReply('Unable to determine my permissions in this server.');
    }
    const channelsToScan = [];
    const channelCandidates = requestedChannel ? [requestedChannel] : Array.from(guild.channels.cache.values());
    for (const channel of channelCandidates) {
        if (!channel || typeof channel.isTextBased !== 'function') continue;
        if (!channel.isTextBased()) continue;
        if (channel.isThread?.()) continue;
        if (!channel.viewable) continue;
        if (!me.permissionsIn(channel).has(PermissionsBitField.Flags.ViewChannel)) continue;
        channelsToScan.push(channel);
    }
    if (!channelsToScan.length) {
        return interaction.editReply('No accessible text channels are available to scan.');
    }
    let processedMessages = 0;
    let processedWords = 0;
    let duplicateMessages = 0;
    let completedChannels = 0;
    const errors = [];
    let nextChannelIndex = 0;
    let oldestTimestamp = null;
    let oldestChannelLabel = null;
    let lastProgressTimestamp = Date.now();

    let progressQueue = Promise.resolve();
    const queueProgressUpdate = async activeLabel => {
        const now = Date.now();
        if (now - lastProgressTimestamp < PROGRESS_UPDATE_INTERVAL_MS) return;
        lastProgressTimestamp = now;
        progressQueue = progressQueue
            .then(() =>
                interaction.editReply({
                    content: buildSyncProgressLine(completedChannels, channelsToScan.length, processedMessages, activeLabel),
                }),
            )
            .catch(() => {});
        await progressQueue;
    };

    const scanChannel = async channel => {
        const channelLabel = channel.name || channel.id;
        let fetched = 0;
        let before = null;
        let channelMessages = 0;
        let channelWords = 0;
        let channelDuplicates = 0;
        let channelOldestTimestamp = null;
        try {
            while (!Number.isFinite(perChannelLimit) || fetched < perChannelLimit) {
                const remaining = Number.isFinite(perChannelLimit) ? perChannelLimit - fetched : FETCH_BATCH_SIZE;
                const batchSize = Math.min(FETCH_BATCH_SIZE, remaining);
                const fetchOptions = { limit: batchSize };
                if (before) fetchOptions.before = before;
                const batch = await channel.messages.fetch(fetchOptions);
                if (!batch.size) break;
                for (const message of batch.values()) {
                    if (!message.author?.id || message.author.bot) continue;
                    if (Number.isFinite(message.createdTimestamp)) {
                        if (channelOldestTimestamp === null || message.createdTimestamp < channelOldestTimestamp) {
                            channelOldestTimestamp = message.createdTimestamp;
                        }
                    }
                    const result = await recordMessage(
                        guild.id,
                        message.author.id,
                        message.author?.tag || message.author?.username || message.author?.globalName || message.author.id,
                        message.content || '',
                        { persist: false, messageId: message.id },
                    );
                    if (result?.isDuplicate) {
                        channelDuplicates += 1;
                        continue;
                    }
                    if (result?.processedWords) {
                        channelWords += result.processedWords;
                    }
                    channelMessages += 1;
                }
                fetched += batch.size;
                before = batch.last()?.id;
                if (batch.size < batchSize) break;
                await queueProgressUpdate(channelLabel);
            }
        } catch (err) {
            return {
                channelLabel,
                channelMessages,
                channelWords,
                channelDuplicates,
                channelOldestTimestamp,
                error: err?.message || 'Unknown error',
            };
        }
        return { channelLabel, channelMessages, channelWords, channelDuplicates, channelOldestTimestamp, error: null };
    };

    const worker = async () => {
        while (true) {
            const index = nextChannelIndex;
            nextChannelIndex += 1;
            if (index >= channelsToScan.length) break;
            const result = await scanChannel(channelsToScan[index]);
            processedMessages += result.channelMessages;
            processedWords += result.channelWords;
            duplicateMessages += result.channelDuplicates;
            completedChannels += 1;
            if (result.error) {
                errors.push(`${result.channelLabel}: ${result.error}`);
            }
            if (Number.isFinite(result.channelOldestTimestamp)) {
                if (oldestTimestamp === null || result.channelOldestTimestamp < oldestTimestamp) {
                    oldestTimestamp = result.channelOldestTimestamp;
                    oldestChannelLabel = result.channelLabel;
                }
            }
            progressQueue = progressQueue
                .then(() =>
                    interaction.editReply({
                        content: buildSyncProgressLine(
                            completedChannels,
                            channelsToScan.length,
                            processedMessages,
                            completedChannels < channelsToScan.length ? result.channelLabel : null,
                        ),
                    }),
                )
                .catch(() => {});
            await progressQueue;
        }
    };

    const workerCount = Math.min(concurrency, channelsToScan.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    try {
        await flushStore();
    } catch (err) {
        errors.push(`word stats store: ${err?.message || 'Failed to save'}`);
    }
    const summaryLines = [
        `Backfill complete (${formatNumber(processedMessages)} messages, ${formatNumber(processedWords)} words added).`,
        `Duplicates skipped: ${formatNumber(duplicateMessages)} already-recorded messages.`,
        `Channels scanned: ${formatNumber(channelsToScan.length)} (up to ${describeLimit(perChannelLimit)} messages per channel, concurrency ${formatNumber(workerCount)}).`,
        `Oldest fetched message: ${oldestTimestamp ? `${formatSyncDate(oldestTimestamp)} (${oldestChannelLabel || 'unknown channel'})` : 'none found in fetched history.'}`,
        'Rescanning the same messages will add duplicates, so limit this command to new history or a fresh store.',
    ];
    if (errors.length) {
        const displayErrors = errors.slice(0, 5).map(err => `- ${err}`);
        summaryLines.push('Errors encountered:');
        summaryLines.push(...displayErrors);
        if (errors.length > 5) summaryLines.push(`- ...and ${errors.length - 5} more errors.`);
    }
    return interaction.editReply({ content: summaryLines.join('\n') });
}
