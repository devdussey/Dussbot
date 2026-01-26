const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');

const LOG_KEY_MAP = {
  created: 'message_create',
  deleted: 'message_delete',
  edited: 'message_edit',
};

const ALL_MESSAGE_KEYS = ['message', LOG_KEY_MAP.created, LOG_KEY_MAP.deleted, LOG_KEY_MAP.edited];

function formatEntry(entry) {
  const enabledText = entry?.enabled === false ? 'Disabled' : 'Enabled';
  const channelText = entry?.channelId ? `<#${entry.channelId}>` : 'No channel set';
  return `${enabledText} — ${channelText}`;
}

function buildSummaryEmbed({ status, scopeLabel, channel, entries }) {
  const embed = new EmbedBuilder()
    .setTitle('Message Log Configuration')
    .setDescription('Non-public confirmation of your message log settings.')
    .setColor(status === 'enable' ? 0x2ecc71 : status === 'disable' ? 0xed4245 : 0xffd166)
    .setTimestamp(new Date())
    .addFields(
      { name: 'Action', value: status === 'current' ? 'Show current setup' : status.charAt(0).toUpperCase() + status.slice(1), inline: true },
      { name: 'Events', value: scopeLabel, inline: true },
      { name: 'Channel', value: channel ? `${channel}` : 'Not provided', inline: true },
    );

  for (const [label, entry] of entries) {
    embed.addFields({ name: label, value: formatEntry(entry), inline: false });
  }

  return embed;
}

async function ensureChannelUsable(channel, guild) {
  const isForum = channel.type === ChannelType.GuildForum;
  if (!channel.isTextBased?.() && !isForum) {
    return 'Please choose a text, announcement, or forum channel.';
  }

  const me = guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null);
  if (!me) return null;

  const required = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.EmbedLinks,
  ];

  if (isForum) {
    required.push(
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.SendMessagesInThreads,
    );
  } else if (typeof channel.isThread === 'function' ? channel.isThread() : Boolean(channel.isThread)) {
    required.push(PermissionsBitField.Flags.SendMessagesInThreads);
  } else {
    required.push(PermissionsBitField.Flags.SendMessages);
  }

  const perms = channel.permissionsFor(me);
  if (!perms || !perms.has(required)) {
    const missing = required.filter(flag => !perms?.has(flag));
    const names = missing.map(flag => Object.entries(PermissionsBitField.Flags).find(([, v]) => v === flag)?.[0] || String(flag));
    return `I need ${names.join(', ')} permissions in ${channel} to post logs.`;
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('messagelogconfig')
    .setDescription('Configure message creation, deletion, and edit logs')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption(option =>
      option
        .setName('status')
        .setDescription('Enable, disable, or view the current setup')
        .setRequired(true)
        .addChoices(
          { name: 'enable', value: 'enable' },
          { name: 'disable', value: 'disable' },
          { name: 'current setup', value: 'current' },
        ))
    .addStringOption(option =>
      option
        .setName('event')
        .setDescription('Which message events to target')
        .setRequired(true)
        .addChoices(
          { name: 'created (green embed)', value: 'created' },
          { name: 'deleted (red embed)', value: 'deleted' },
          { name: 'edited (yellow embed)', value: 'edited' },
          { name: 'all message events', value: 'all' },
        ))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to use for the selected message logs')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure message logs.', ephemeral: true });
    }

    const status = interaction.options.getString('status', true);
    const scope = interaction.options.getString('event', true);
    const channel = interaction.options.getChannel('channel', true);

    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'Could not resolve this server. Please try again.', ephemeral: true });
    }

    const keys = scope === 'all'
      ? [...ALL_MESSAGE_KEYS]
      : [LOG_KEY_MAP[scope]].filter(Boolean);

    if (!keys.length) {
      return interaction.reply({ content: 'Unknown event selection.', ephemeral: true });
    }

    const channelError = await ensureChannelUsable(channel, guild);
    if (channelError) {
      return interaction.reply({ content: channelError, ephemeral: true });
    }

    const entries = [];

    try {
      if (status !== 'current') {
        for (const key of keys) {
          if (status === 'enable') {
            // Set channel first to guarantee routing path exists when enabling.
            await logChannelTypeStore.setChannel(guild.id, key, channel.id);
            await logChannelTypeStore.setEnabled(guild.id, key, true);
          } else if (status === 'disable') {
            await logChannelTypeStore.setEnabled(guild.id, key, false);
            // Keep existing channel so re-enable is quick; do not remove.
          }
        }
      }

      for (const key of keys) {
        const entry = await logChannelTypeStore.getEntry(guild.id, key);
        entries.push([`${key.replace(/_/g, ' ').toUpperCase()}`, entry]);
      }

      const scopeLabel = scope === 'all'
        ? 'All message events'
        : `${scope.charAt(0).toUpperCase()}${scope.slice(1)} messages`;

      const embed = buildSummaryEmbed({ status, scopeLabel, channel, entries });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error('Failed to update message log config:', err);
      return interaction.reply({ content: 'Failed to update message log configuration. Please try again later.', ephemeral: true });
    }
  },
};
