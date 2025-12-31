const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOwner } = require('../utils/ownerIds');
const backupStore = require('../utils/backupStore');
const securityLogger = require('../utils/securityLogger');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function formatWhen(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  const unix = Math.floor(timestamp / 1000);
  return `<t:${unix}:f>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backuplist')
    .setDescription('Owner-only: list backups for this server'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!isOwner(interaction.user.id)) {
      try { await securityLogger.logPermissionDenied(interaction, 'backuplist', 'User is not a bot owner'); } catch (_) {}
      return interaction.reply({ content: 'This command is restricted to bot owners.', ephemeral: true });
    }

    const backups = backupStore.listBackups(interaction.guildId);
    if (!backups.length) {
      return interaction.reply({ content: 'No backups have been created for this server yet.', ephemeral: true });
    }

    const maxShown = 25;
    const lines = backups.slice(0, maxShown).map(backup => {
      const who = backup.createdBy?.tag ? `by ${backup.createdBy.tag}` : 'by unknown';
      return `#${backup.id} - ${formatWhen(backup.createdAt)} ${who}`;
    });

    if (backups.length > maxShown) {
      lines.push(`...and ${backups.length - maxShown} more`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`Backups for ${interaction.guild?.name || 'this server'}`)
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Total backups: ${backups.length}` })
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
