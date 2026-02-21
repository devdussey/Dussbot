const path = require('path');
const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const {
  getConfig,
  setTrackedChannel,
  clearGuild,
  parseBackfillPayload,
  importBackfill,
} = require('../utils/wordStatsConfigStore');
const {
  scanChannelAll,
  getResumeStatus,
} = require('../utils/wordStatsScanService');

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const SCAN_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
}

function relativeFromCwd(filePath) {
  if (!filePath) return 'n/a';
  const rel = path.relative(process.cwd(), filePath);
  if (!rel || rel === '') return filePath;
  return rel.replace(/\\/g, '/');
}

function formatOptionalUtc(raw) {
  const text = String(raw || '').trim();
  return text || 'none';
}

function buildScanProgressMessage(channel, options, snapshot) {
  const startText = formatOptionalUtc(options.startUtc);
  const endText = formatOptionalUtc(options.endUtc);
  return [
    `Scanning ${channel} newest -> oldest in pages of 100...`,
    `Range UTC: start=${startText} | end=${endText}`,
    `Scanned: ${formatNumber(snapshot.scanned_messages)} (${snapshot.rate_messages_per_second} msg/s)`,
    `Text/Media: ${formatNumber(snapshot.text_only)} text_only | ${formatNumber(snapshot.media_any)} media_any`,
    `Media breakdown: image=${formatNumber(snapshot.image)} gif=${formatNumber(snapshot.gif)} sticker=${formatNumber(snapshot.sticker)}`,
    `Words: total=${formatNumber(snapshot.total_words)} unique=${formatNumber(snapshot.unique_words)}`,
    `Duplicates ignored: ${formatNumber(snapshot.duplicate_messages_ignored)}`,
    `Checkpoint: ${snapshot.checkpoint_file}`,
    `Cursor before_id: ${snapshot.cursor_before_id || 'none'}`,
    `Resume from message #: ${formatNumber(snapshot.resume_from_message_number)}`,
  ].join('\n');
}

function buildFinalScanMessage(channel, options, result) {
  const startText = formatOptionalUtc(options.startUtc);
  const endText = formatOptionalUtc(options.endUtc);
  const state = result.state;
  const totals = state.totals || {};
  const lines = [
    `Scan completed for ${channel}.`,
    `Range UTC: start=${startText} | end=${endText}`,
    `Include bots: ${options.includeBots ? 'yes' : 'no'} | Resume requested: ${options.resume ? 'yes' : 'no'} | Resumed: ${result.resumed ? 'yes' : 'no'}`,
    `Scanned: ${formatNumber(totals.scanned_messages)} messages`,
    `Text/Media: ${formatNumber(totals.text_only)} text_only | ${formatNumber(totals.media_any)} media_any`,
    `Media breakdown: image=${formatNumber(totals.image)} gif=${formatNumber(totals.gif)} sticker=${formatNumber(totals.sticker)}`,
    `Words: total=${formatNumber(totals.total_words)} unique=${formatNumber(totals.unique_words)}`,
    `Duplicates ignored: ${formatNumber(totals.duplicate_messages_ignored)}`,
    `Checkpoint: \`${relativeFromCwd(result.checkpointPath)}\``,
    `Output JSON: \`${relativeFromCwd(result.outputPath)}\``,
  ];
  return lines.join('\n');
}

async function fetchBackfillAttachment(attachment) {
  if (!attachment?.url) return null;
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Backfill file is too large. Max supported size is ${formatNumber(MAX_ATTACHMENT_BYTES)} bytes.`);
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download backfill file (HTTP ${response.status}).`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_err) {
    throw new Error('Backfill file must be valid JSON.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordstatsconfig')
    .setDescription('Configure live message count tracking and channel scan exports for word stats.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Set the tracked channel for live message count tracking.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to track new message counts in.')
            .setRequired(true)
            .addChannelTypes(...SCAN_CHANNEL_TYPES),
        )
        .addAttachmentOption((option) =>
          option
            .setName('backfill')
            .setDescription('Optional JSON export to import historical message counts.'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('scan')
        .setDescription('Scan full channel history to JSON (resumable checkpoint, newest -> oldest).')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to scan.')
            .setRequired(true)
            .addChannelTypes(...SCAN_CHANNEL_TYPES),
        )
        .addStringOption((option) =>
          option
            .setName('start_utc')
            .setDescription('Only include messages on/after this UTC time (ISO, e.g. 2026-02-01T00:00:00Z).')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('end_utc')
            .setDescription('Only include messages on/before this UTC time (ISO, e.g. 2026-02-20T23:59:59Z).')
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('include_bots')
            .setDescription('Include bot-authored messages in the scan.')
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('resume')
            .setDescription('Resume from the last checkpoint if available (default: true).')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('resume')
        .setDescription('Show checkpoint status (cursor + resume position) without scanning.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to check.')
            .setRequired(true)
            .addChannelTypes(...SCAN_CHANNEL_TYPES),
        )
        .addStringOption((option) =>
          option
            .setName('start_utc')
            .setDescription('Must match the scan range start UTC used previously.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('end_utc')
            .setDescription('Must match the scan range end UTC used previously.')
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('include_bots')
            .setDescription('Must match the include_bots setting used for the scan.')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('Show the current word stats tracking configuration.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Remove the tracked channel and clear imported/tracked counts.'),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used inside a server.' });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      const config = getConfig(interaction.guildId);
      const channelMention = config.trackedChannelId ? `<#${config.trackedChannelId}>` : 'Not configured';
      return interaction.reply({
        content: [
          'Word stats live tracking configuration:',
          `• Tracked channel: ${channelMention}`,
          `• Tracked users: ${formatNumber(config.trackedUsers)}`,
          `• Total messages stored: ${formatNumber(config.totalMessages)}`,
        ].join('\n'),
      });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'You need **Manage Server** permission to change this configuration.' });
    }

    if (subcommand === 'resume') {
      const channel = interaction.options.getChannel('channel', true);
      const startUtc = interaction.options.getString('start_utc');
      const endUtc = interaction.options.getString('end_utc');
      const includeBots = interaction.options.getBoolean('include_bots') ?? false;

      let status;
      try {
        status = await getResumeStatus({
          guildId: interaction.guildId,
          channelId: channel.id,
          startUtcInput: startUtc,
          endUtcInput: endUtc,
          includeBots,
        });
      } catch (err) {
        return interaction.reply({ content: `Resume status failed: ${err.message}`, ephemeral: true });
      }

      if (!status.found) {
        return interaction.reply({
          content: [
            `No checkpoint found for ${channel}.`,
            `Expected file: \`${relativeFromCwd(status.checkpointPath)}\``,
            `Range UTC: start=${formatOptionalUtc(startUtc)} | end=${formatOptionalUtc(endUtc)} | include_bots=${includeBots ? 'true' : 'false'}`,
          ].join('\n'),
          ephemeral: true,
        });
      }

      const state = status.state;
      const totals = state.totals || {};
      return interaction.reply({
        content: [
          `Checkpoint status for ${channel}:`,
          `File: \`${relativeFromCwd(status.checkpointPath)}\``,
          `Cursor (before_id): ${state.cursor_before_id || 'none'}`,
          `Resume from message #: ${formatNumber(state.resume_from_message_number)}`,
          `Last updated UTC: ${state.last_updated_utc || 'unknown'}`,
          `Completed: ${state.completed ? `yes (${state.completed_utc || 'timestamp missing'})` : 'no'}`,
          `Scanned: ${formatNumber(totals.scanned_messages)}`,
          `Text/Media: ${formatNumber(totals.text_only)} text_only | ${formatNumber(totals.media_any)} media_any`,
          `Media breakdown: image=${formatNumber(totals.image)} gif=${formatNumber(totals.gif)} sticker=${formatNumber(totals.sticker)}`,
          `Words: total=${formatNumber(totals.total_words)} unique=${formatNumber(totals.unique_words)}`,
          `Duplicates ignored: ${formatNumber(totals.duplicate_messages_ignored)}`,
        ].join('\n'),
        ephemeral: true,
      });
    }

    if (subcommand === 'scan') {
      const channel = interaction.options.getChannel('channel', true);
      const startUtc = interaction.options.getString('start_utc');
      const endUtc = interaction.options.getString('end_utc');
      const includeBots = interaction.options.getBoolean('include_bots') ?? false;
      const resumeOption = interaction.options.getBoolean('resume');
      const resume = resumeOption === null ? true : resumeOption;

      const options = { startUtc, endUtc, includeBots, resume };
      const initialMessage = [
        `Starting scan for ${channel}...`,
        `Range UTC: start=${formatOptionalUtc(startUtc)} | end=${formatOptionalUtc(endUtc)}`,
        `Include bots: ${includeBots ? 'yes' : 'no'} | Resume: ${resume ? 'yes' : 'no'}`,
      ].join('\n');

      const progressMessage = await interaction.reply({ content: initialMessage, fetchReply: true });
      const safeEditProgress = async (content) => {
        try {
          await progressMessage.edit({ content });
        } catch (_) {
          try { await interaction.editReply({ content }); } catch (__err) {}
        }
      };

      try {
        const result = await scanChannelAll({
          guild: interaction.guild,
          channel,
          startUtcInput: startUtc,
          endUtcInput: endUtc,
          includeBots,
          resume,
          onProgress: async (snapshot) => {
            await safeEditProgress(buildScanProgressMessage(channel, options, snapshot));
          },
        });

        if (result.alreadyCompleted) {
          return safeEditProgress([
            `Checkpoint already marked completed for ${channel}.`,
            `Checkpoint: \`${relativeFromCwd(result.checkpointPath)}\``,
            'Use `/wordstatsconfig scan` with `resume:false` to restart from newest.',
          ].join('\n'));
        }

        return safeEditProgress(buildFinalScanMessage(channel, options, result));
      } catch (err) {
        return safeEditProgress(`Scan failed for ${channel}: ${err.message}`);
      }
    }

    if (subcommand === 'reset') {
      const existed = await clearGuild(interaction.guildId);
      return interaction.reply({
        content: existed
          ? 'Word stats tracking has been reset. Channel config and saved counts were removed.'
          : 'No word stats tracking configuration existed for this server.',
      });
    }

    const channel = interaction.options.getChannel('channel', true);
    const backfill = interaction.options.getAttachment('backfill');

    let importSummary = null;
    if (backfill) {
      let parsed;
      try {
        parsed = await fetchBackfillAttachment(backfill);
      } catch (err) {
        return interaction.reply({ content: `Backfill failed: ${err.message}` });
      }
      const entries = parseBackfillPayload(parsed, interaction.guildId);
      if (!entries.length) {
        return interaction.reply({
          content:
            'Backfill file was valid JSON, but no usable counts were found. Supported layouts include `{ "users": { "userId": { "count": 12 }}}`, arrays of user objects, `{ "guilds": { "<guildId>": { "users": ... }}}`, and user maps where each value is a message array.',
        });
      }
      importSummary = await importBackfill(interaction.guildId, entries);
    }

    const config = await setTrackedChannel(interaction.guildId, channel.id);
    const baseLines = [
      `Word stats live tracking is now set to ${channel}.`,
      `Current saved users: ${formatNumber(config.trackedUsers)}`,
      `Current saved message total: ${formatNumber(config.totalMessages)}`,
    ];

    if (importSummary) {
      baseLines.push(
        `Backfill imported ${formatNumber(importSummary.importedMessages)} messages across ${formatNumber(importSummary.importedUsers)} user entries.`,
      );
    }

    return interaction.reply({ content: baseLines.join('\n') });
  },
};

export {};

