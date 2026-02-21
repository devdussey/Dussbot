const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/securityLogger');
const modlog = require('../utils/modLogger');
const { buildModActionEmbed } = require('../utils/modActionResponseEmbed');

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

    await interaction.deferReply({ ephemeral: true });

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      await logger.logPermissionDenied(interaction, 'unban', 'Bot missing Ban Members');
      return interaction.editReply({ content: 'I need the Ban Members permission.' });
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
      const embed = buildModActionEmbed(interaction, {
        title: 'Member Unbanned',
        targetUser: user,
        reason,
        color: 0x57f287,
        extraFields: [
          { name: 'Target', value: `${user.tag} (${user.id})`, inline: false },
        ],
      });
      try {
        await interaction.followUp({ embeds: [embed], ephemeral: false });
        try { await interaction.deleteReply(); } catch (_) {}
      } catch (_) {
        await interaction.editReply({ embeds: [embed] });
      }
      try {
        await modlog.log(interaction, 'User Unbanned', {
          target: `${user.tag} (${user.id})`,
          reason,
          color: 0x57f287,
        });
      } catch (_) {}
    } catch (err) {
      const embed = buildModActionEmbed(interaction, {
        title: 'Unban Failed',
        targetUser: user,
        reason: err.message || 'Unknown error',
        color: 0xed4245,
      });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
