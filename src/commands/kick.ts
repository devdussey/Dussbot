import path from 'node:path';
import { PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const logger = requireFromSrcIfNeeded('../utils/securityLogger');
const modlog = requireFromSrcIfNeeded('../utils/modLogger');
const { buildModActionEmbed } = requireFromSrcIfNeeded('../utils/modActionResponseEmbed');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server (reason required)')
    .addUserOption((opt) =>
      opt
        .setName('target')
        .setDescription('Member to kick')
        .setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason for the kick (required)')
        .setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      await logger.logPermissionDenied(interaction, 'kick', 'Bot missing Kick Members');
      return interaction.editReply({ content: 'I need the Kick Members permission.' });
    }

    const user = interaction.options.getUser('target', true);
    const reasonRaw = interaction.options.getString('reason', true).trim();
    if (!reasonRaw) {
      return interaction.editReply({ content: 'Please provide a reason for the kick.' });
    }

    const reason = reasonRaw.slice(0, 400);
    if (user.id === interaction.user.id) {
      return interaction.editReply({ content: "You can't kick yourself." });
    }
    if (user.id === interaction.client.user.id) {
      return interaction.editReply({ content: "You can't kick me with this command." });
    }

    let memberToKick: any;
    try {
      memberToKick = await interaction.guild.members.fetch(user.id);
    } catch (_) {
      return interaction.editReply({ content: 'That user is not in this server.' });
    }

    const meHigher = me.roles.highest.comparePositionTo(memberToKick.roles.highest) > 0;
    if (!meHigher || !memberToKick.kickable) {
      await logger.logHierarchyViolation(interaction, 'kick', memberToKick, 'Bot lower than target or not kickable');
      return interaction.editReply({ content: "I can't kick that member due to role hierarchy or permissions." });
    }

    const requesterMember = await interaction.guild.members.fetch(interaction.user.id);
    const requesterHigher = requesterMember.roles.highest.comparePositionTo(memberToKick.roles.highest) > 0
      || interaction.guild.ownerId === interaction.user.id;
    if (!requesterHigher) {
      await logger.logHierarchyViolation(interaction, 'kick', memberToKick, 'Requester lower or equal to target');
      return interaction.editReply({ content: "You can't kick someone with an equal or higher role." });
    }

    try {
      const auditReason = `By ${interaction.user.tag} (${interaction.user.id}) | ${reason}`.slice(0, 512);
      await memberToKick.kick(auditReason);

      let logSent = false;
      let publicSent = false;
      try {
        const result = await modlog.logAction(interaction, {
          action: 'Kick',
          verb: 'kicked',
          targetUser: user,
          reason,
        });
        logSent = Boolean(result?.logSent);
        publicSent = Boolean(result?.publicSent);
      } catch (_) {}

      if (logSent && publicSent) {
        await interaction.deleteReply().catch(() => {});
      } else {
        const missing = [
          !logSent ? 'mod log channel' : null,
          !publicSent ? 'public response channel' : null,
        ].filter(Boolean).join(' and ');
        await interaction.editReply({ content: `Kicked ${user.tag} successfully, but I could not post to the ${missing}.` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const embed = buildModActionEmbed(interaction, {
        title: 'Kick Failed',
        targetUser: user,
        reason: message,
        color: 0xed4245,
      });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export = command;
