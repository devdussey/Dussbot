const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const store = require('../utils/autoMessageStore');
const scheduler = require('../utils/autoMessageScheduler');

const INTERVAL_CHOICES = [
  { name: '1 hour', value: 1 },
  { name: '3 hours', value: 3 },
  { name: '6 hours', value: 6 },
  { name: '12 hours', value: 12 },
  { name: '24 hours', value: 24 },
];

function parseColor(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^#/, '').replace(/^0x/i, '');
  const num = parseInt(normalized, 16);
  if (Number.isNaN(num)) return undefined;
  return Math.max(0, Math.min(0xFFFFFF, num));
}

function parseImageUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.toString();
  } catch (_) {
    return undefined;
  }
}

function formatHours(ms) {
  const hrs = ms / 3_600_000;
  return `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)}h`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automessage')
    .setDescription('Schedule automatic messages or embeds on a timer')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create an automatic message or embed')
        .addIntegerOption(opt =>
          opt.setName('hours')
            .setDescription('How often to send')
            .setRequired(true)
            .addChoices(...INTERVAL_CHOICES)
        )
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel to post in (defaults to here)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
            )
        )
        .addStringOption(opt =>
          opt.setName('message')
            .setDescription('Plain text message to send')
        )
        .addStringOption(opt =>
          opt.setName('embed_title')
            .setDescription('Embed title (optional)')
        )
        .addStringOption(opt =>
          opt.setName('embed_description')
            .setDescription('Embed description (optional)')
        )
        .addStringOption(opt =>
          opt.setName('embed_footer')
            .setDescription('Embed footer text (optional)')
        )
        .addStringOption(opt =>
          opt.setName('embed_color')
            .setDescription('Hex colour for the embed (e.g. #5865F2)')
        )
        .addStringOption(opt =>
          opt.setName('embed_image')
            .setDescription('Image or GIF URL for the embed')
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete an automatic message by ID')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Automessage ID (see /automessage list)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List configured automatic messages')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.editReply({ content: 'You need the Manage Server permission to configure automessages.' });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'create') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const hours = interaction.options.getInteger('hours', true);
      const message = interaction.options.getString('message')?.trim();
      const embedTitle = interaction.options.getString('embed_title')?.trim();
      const embedDescription = interaction.options.getString('embed_description')?.trim();
      const embedFooter = interaction.options.getString('embed_footer')?.trim();
      const colorInput = interaction.options.getString('embed_color');
      const imageInput = interaction.options.getString('embed_image');
      const color = parseColor(colorInput);
      const imageUrl = parseImageUrl(imageInput);

      if (colorInput && color === undefined) {
        return interaction.editReply({ content: 'Embed color must be a valid hex value like `#5865F2`.' });
      }
      if (imageInput && imageUrl === undefined) {
        return interaction.editReply({ content: 'Embed image must be a valid http(s) URL.' });
      }

      const embed = {};
      if (embedTitle) embed.title = embedTitle;
      if (embedDescription) embed.description = embedDescription;
      if (embedFooter) embed.footer = { text: embedFooter };
      if (color !== null && color !== undefined) embed.color = color;
      if (imageUrl) embed.image = { url: imageUrl };
      const hasEmbed = Object.keys(embed).length > 0;

      if (!message && !hasEmbed) {
        return interaction.editReply({ content: 'Provide a message or at least one embed field.' });
      }

      const intervalMs = Math.max(1, hours) * 3_600_000;
      const job = await store.addJob(guildId, {
        channelId: channel.id,
        content: message || '',
        embed: hasEmbed ? embed : null,
        intervalMs,
      });
      try { scheduler.startJob(interaction.client, guildId, job); } catch (_) {}
      const summaryParts = [];
      if (message) summaryParts.push('message');
      if (hasEmbed) summaryParts.push('embed');
      return interaction.editReply({
        content: `Automessage #${job.id} scheduled in ${channel} every ${hours}h (${summaryParts.join(' & ')}).`,
      });
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id', true);
      const removed = await store.removeJob(guildId, id);
      scheduler.stopJob(guildId, id);
      return interaction.editReply({ content: removed ? `Removed automessage #${id}.` : `Automessage #${id} not found.` });
    }

    if (sub === 'list') {
      const jobs = await store.listJobs(guildId);
      if (!jobs.length) return interaction.editReply({ content: 'No automessages configured yet.' });
      const lines = jobs.map(job => {
        const parts = [
          `#${job.id}`,
          job.enabled ? '[ON]' : '[OFF]',
          `every ${formatHours(job.intervalMs)}`,
          `in <#${job.channelId}>`,
        ];
        if (job.embed) parts.push('[embed]');
        if (job.content) parts.push(job.content.slice(0, 60));
        return parts.join(' ');
      });
      return interaction.editReply({ content: lines.join('\n') });
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },
};
