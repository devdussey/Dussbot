const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOwner } = require('../utils/ownerIds');
const backupStore = require('../utils/backupStore');
const securityLogger = require('../utils/securityLogger');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function formatWhen(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  const unix = Math.floor(timestamp / 1000);
  return `<t:${unix}:f>`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sanitizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildPreview(items, formatter, max = 5) {
  if (!Array.isArray(items) || items.length === 0) return 'None';
  const lines = items.slice(0, max).map(item => sanitizeLine(formatter(item)));
  let output = lines.join('\n');
  if (items.length > max) {
    output += `\n...and ${items.length - max} more`;
  }
  return output || 'None';
}

function formatRole(role) {
  const name = role?.name || role?.id || 'Unknown role';
  const color = role?.hexColor || (Number.isFinite(role?.color) ? `#${Number(role.color).toString(16).padStart(6, '0')}` : null);
  return color ? `${name} (${color})` : name;
}

function formatChannel(channel) {
  const name = channel?.name || channel?.id || 'Unknown channel';
  const kind = channel?.kind || channel?.type;
  return typeof kind !== 'undefined' && kind !== null ? `${name} (${kind})` : name;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupview')
    .setDescription('Owner-only: view a backup summary or export JSON')
    .addStringOption(opt =>
      opt
        .setName('id')
        .setDescription('Backup id from /backuplist')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!isOwner(interaction.user.id)) {
      try { await securityLogger.logPermissionDenied(interaction, 'backupview', 'User is not a bot owner'); } catch (_) {}
      return interaction.reply({ content: 'This command is restricted to bot owners.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const id = interaction.options.getString('id', true).trim();
    const backup = backupStore.getBackup(interaction.guildId, id);
    if (!backup) {
      return interaction.editReply({ content: `No backup found with id "${id}".` });
    }

    const snapshot = backup.snapshot || {};
    const bans = snapshot.bans?.items || [];
    const channels = snapshot.channels?.items || [];
    const roles = snapshot.roles?.items || [];
    const bots = snapshot.bots?.items || [];

    const embed = new EmbedBuilder()
      .setTitle(`Backup #${backup.id}`)
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setDescription(`Server: ${backup.guildName || interaction.guild?.name || 'Unknown'}`)
      .addFields(
        { name: 'Created', value: formatWhen(backup.createdAt), inline: true },
        { name: 'Created By', value: backup.createdBy?.tag || 'Unknown', inline: true },
        {
          name: 'Counts',
          value: [
            `Bans: ${snapshot.bans?.count ?? bans.length}`,
            `Channels: ${snapshot.channels?.count ?? channels.length}`,
            `Roles: ${snapshot.roles?.count ?? roles.length}`,
            `Bots: ${snapshot.bots?.count ?? bots.length}`,
          ].join('\n'),
          inline: false,
        },
      )
      .addFields(
        { name: 'Bans (preview)', value: buildPreview(bans, ban => ban.tag || ban.userId || 'Unknown') },
        { name: 'Channels (preview)', value: buildPreview(channels, formatChannel) },
        { name: 'Roles (preview)', value: buildPreview(roles, formatRole) },
        { name: 'Bots (preview)', value: buildPreview(bots, bot => bot.tag || bot.id || 'Unknown') },
      )
      .setTimestamp(new Date());

    if (snapshot.channels?.partial || snapshot.roles?.partial || snapshot.bots?.partial) {
      const notes = [];
      if (snapshot.channels?.partial) notes.push('Channels were captured from cache.');
      if (snapshot.roles?.partial) notes.push('Roles were captured from cache.');
      if (snapshot.bots?.partial) notes.push('Bot list may be partial.');
      if (notes.length) embed.addFields({ name: 'Partial Data', value: notes.join(' ') });
    }

    if (Array.isArray(backup.warnings) && backup.warnings.length) {
      embed.addFields({ name: 'Warnings', value: backup.warnings.slice(0, 5).join('\n') });
    }

    const exportPayload = { ...backup, exportedAt: Date.now() };
    const json = JSON.stringify(exportPayload, null, 2);
    const size = Buffer.byteLength(json);
    const files = [];
    if (size <= MAX_ATTACHMENT_BYTES) {
      files.push({ attachment: Buffer.from(json), name: `backup-${backup.id}.json` });
    } else {
      embed.addFields({ name: 'Backup File', value: `JSON export too large (${formatBytes(size)}).` });
    }

    return interaction.editReply({
      embeds: [embed],
      files,
      allowedMentions: { parse: [] },
    });
  },
};
