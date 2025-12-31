const { SlashCommandBuilder } = require('discord.js');
const { isOwner } = require('../utils/ownerIds');
const backupStore = require('../utils/backupStore');
const securityLogger = require('../utils/securityLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupdelete')
    .setDescription('Owner-only: delete a backup by id')
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
      try { await securityLogger.logPermissionDenied(interaction, 'backupdelete', 'User is not a bot owner'); } catch (_) {}
      return interaction.reply({ content: 'This command is restricted to bot owners.', ephemeral: true });
    }

    const id = interaction.options.getString('id', true).trim();
    const existing = backupStore.getBackup(interaction.guildId, id);
    if (!existing) {
      return interaction.reply({ content: `No backup found with id "${id}".`, ephemeral: true });
    }

    backupStore.removeBackup(interaction.guildId, id);
    return interaction.reply({ content: `Deleted backup #${existing.id} for ${interaction.guild?.name || 'this server'}.`, ephemeral: true });
  },
};
