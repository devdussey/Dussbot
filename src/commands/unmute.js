const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/securityLogger');
const modlog = require('../utils/modLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a timeout from a member (reason required)')
    .addUserOption(opt =>
      opt
        .setName('target')
        .setDescription('Member to unmute')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Reason for the unmute (required)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply();

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      await logger.logPermissionDenied(interaction, 'unmute', 'Bot missing Moderate Members');
      return interaction.editReply({ content: 'I need the Moderate Members permission.' });
    }
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ModerateMembers)) {
      await logger.logPermissionDenied(interaction, 'unmute', 'User missing Moderate Members');
      return interaction.editReply({ content: 'You need Moderate Members to use this command.' });
    }

    const user = interaction.options.getUser('target', true);
    const reasonRaw = interaction.options.getString('reason', true) || '';
    const reason = reasonRaw.trim().slice(0, 400);
    if (!reason) {
      return interaction.editReply({ content: 'Please provide a reason for the unmute.' });
    }

    if (user.id === interaction.client.user.id) {
      return interaction.editReply({ content: "I can't unmute myself." });
    }

    let member;
    try {
      member = await interaction.guild.members.fetch(user.id);
    } catch (_) {}

    if (!member) {
      return interaction.editReply({ content: 'That user is not in this server.' });
    }

    const auditReason = `By ${interaction.user.tag} (${interaction.user.id}) | ${reason}`.slice(0, 512);
    try {
      await member.timeout(null, auditReason);
      await interaction.editReply({ content: `Unmuted ${user.tag} for: ${reason}` });
      try {
        await modlog.log(interaction, 'Member Unmuted', {
          target: `${user.tag} (${user.id})`,
          reason,
          color: 0x57f287,
        });
      } catch (_) {}
    } catch (err) {
      await interaction.editReply({ content: `Failed to unmute: ${err.message || 'Unknown error'}` });
    }
  },
};
