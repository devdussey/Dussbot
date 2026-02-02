const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/securityLogger');
const modlog = require('../utils/modLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user (reason required)')
    .addUserOption(opt =>
      opt
        .setName('target')
        .setDescription('User to unban')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Reason for the unban (required)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply();

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      await logger.logPermissionDenied(interaction, 'unban', 'Bot missing Ban Members');
      return interaction.editReply({ content: 'I need the Ban Members permission.' });
    }
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.BanMembers)) {
      await logger.logPermissionDenied(interaction, 'unban', 'User missing Ban Members');
      return interaction.editReply({ content: 'You need Ban Members to use this command.' });
    }

    const user = interaction.options.getUser('target', true);
    const reasonRaw = interaction.options.getString('reason', true) || '';
    const reason = reasonRaw.trim().slice(0, 400);
    if (!reason) {
      return interaction.editReply({ content: 'Please provide a reason for the unban.' });
    }

    if (user.id === interaction.client.user.id) {
      return interaction.editReply({ content: "I can't unban myself." });
    }

    try {
      const auditReason = `By ${interaction.user.tag} (${interaction.user.id}) | ${reason}`.slice(0, 512);
      await interaction.guild.members.unban(user.id, auditReason);
      await interaction.editReply({ content: `Unbanned ${user.tag} for: ${reason}` });
      try {
        await modlog.log(interaction, 'User Unbanned', {
          target: `${user.tag} (${user.id})`,
          reason,
          color: 0x57f287,
        });
      } catch (_) {}
    } catch (err) {
      await interaction.editReply({ content: `Failed to unban: ${err.message || 'Unknown error'}` });
    }
  },
};
