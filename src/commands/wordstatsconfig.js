const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const {
  getConfig,
  setTrackedChannel,
  clearGuild,
  parseBackfillPayload,
  importBackfill,
} = require('../utils/wordStatsConfigStore');

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
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
    .setDescription('Configure live message count tracking for a specific channel.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Set the tracked channel for live message count tracking.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to track new message counts in.')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread),
        )
        .addAttachmentOption((option) =>
          option
            .setName('backfill')
            .setDescription('Optional JSON export to import historical message counts.'),
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
