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
    .setName('unmute')
    .setDescription('Remove a timeout from a member (reason required)')
    .addUserOption((opt) =>
      opt
        .setName('target')
        .setDescription('Member to unmute')
        .setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason for the unmute (required)')
        .setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
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

    let member: any = null;
    try {
      member = await interaction.guild.members.fetch(user.id);
    } catch (_) {
      member = null;
    }

    if (!member) {
      return interaction.editReply({ content: 'That user is not in this server.' });
    }

    const auditReason = `By ${interaction.user.tag} (${interaction.user.id}) | ${reason}`.slice(0, 512);
    try {
      await member.timeout(null, auditReason);
      let logSent = false;
      let publicSent = false;
      try {
        const result = await modlog.logAction(interaction, {
          action: 'Unmute',
          verb: 'unmuted',
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
        await interaction.editReply({ content: `Unmuted ${user.tag} successfully, but I could not post to the ${missing}.` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const embed = buildModActionEmbed(interaction, {
        title: 'Unmute Failed',
        targetUser: user,
        reason: message,
        color: 0xed4245,
      });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export = command;
