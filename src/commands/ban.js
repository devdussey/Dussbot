const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/securityLogger');
const modlog = require('../utils/modLogger');
const { buildModActionEmbed } = require('../utils/modActionResponseEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server (reason required)')
    .addUserOption(opt =>
      opt
        .setName('target')
        .setDescription('User to ban')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Reason for the ban (required)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('prune_days')
        .setDescription('Delete up to 7 days of messages')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      await logger.logPermissionDenied(interaction, 'ban', 'Bot missing Ban Members');
      return interaction.editReply({ content: 'I need the Ban Members permission.' });
    }
    const user = interaction.options.getUser('target', true);
    const reasonRaw = interaction.options.getString('reason', true).trim();
    if (!reasonRaw) {
      return interaction.editReply({ content: 'Please provide a reason for the ban.' });
    }
    const pruneDays = interaction.options.getInteger('prune_days') ?? 0;
    const pruneSeconds = Math.min(Math.max(pruneDays, 0), 7) * 86400;
    const reason = reasonRaw.slice(0, 400);

    if (user.id === interaction.user.id) {
      return interaction.editReply({ content: "You can't ban yourself." });
    }
    if (user.id === interaction.client.user.id) {
      return interaction.editReply({ content: "You can't ban me with this command." });
    }

    // Try to fetch member for hierarchy checks if they are in the guild
    let targetMember = null;
    try { targetMember = await interaction.guild.members.fetch(user.id); } catch (_) {}

    if (targetMember) {
      const meHigher = me.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
      if (!meHigher || !targetMember.bannable) {
        await logger.logHierarchyViolation(interaction, 'ban', targetMember, 'Bot lower than target or not bannable');
        return interaction.editReply({ content: "I can't ban that member due to role hierarchy or permissions." });
      }

      const requesterHigher = interaction.member.roles.highest.comparePositionTo(targetMember.roles.highest) > 0
        || interaction.guild.ownerId === interaction.user.id;
      if (!requesterHigher) {
        await logger.logHierarchyViolation(interaction, 'ban', targetMember, 'Requester lower or equal to target');
        return interaction.editReply({ content: "You can't ban someone with an equal or higher role." });
      }
    }

    try {
      const auditReason = `By ${interaction.user.tag} (${interaction.user.id}) | ${reason}`.slice(0, 512);
      await interaction.guild.members.ban(user.id, {
        deleteMessageSeconds: pruneSeconds,
        reason: auditReason,
      });
      const embed = buildModActionEmbed(interaction, {
        title: 'Member Banned',
        targetUser: user,
        reason,
        color: 0xff0000,
        extraFields: [
          { name: 'Target', value: `${user.tag} (${user.id})`, inline: false },
          { name: 'Prune Days', value: String(pruneDays), inline: true },
        ],
      });
      try {
        await interaction.followUp({ embeds: [embed], ephemeral: false });
        try { await interaction.deleteReply(); } catch (_) {}
      } catch (_) {
        await interaction.editReply({ embeds: [embed] });
      }
        try { await modlog.log(interaction, 'User Banned', {
          target: `${user.tag} (${user.id})`,
          reason,
          extraFields: [
            { name: 'Prune days', value: String(pruneDays), inline: true },
          ],
          color: 0xff0000,
        }); } catch (_) {}
    } catch (err) {
      const embed = buildModActionEmbed(interaction, {
        title: 'Ban Failed',
        targetUser: user,
        reason: err.message || 'Unknown error',
        color: 0xed4245,
      });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
