const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/securityLogger');
const modlog = require('../utils/modLogger');
const { buildModActionEmbed } = require('../utils/modActionResponseEmbed');

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

    await interaction.deferReply({ ephemeral: true });

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      await logger.logPermissionDenied(interaction, 'unmute', 'Bot missing Moderate Members');
      return interaction.editReply({ content: 'I need the Moderate Members permission.' });
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
      const embed = buildModActionEmbed(interaction, {
        title: 'Member Unmuted',
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
        await modlog.log(interaction, 'Member Unmuted', {
          target: `${user.tag} (${user.id})`,
          reason,
          color: 0x57f287,
        });
      } catch (_) {}
    } catch (err) {
      const embed = buildModActionEmbed(interaction, {
        title: 'Unmute Failed',
        targetUser: user,
        reason: err.message || 'Unknown error',
        color: 0xed4245,
      });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
