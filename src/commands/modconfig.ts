import path from 'node:path';
import { ChannelType, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const modLogStore = requireFromSrcIfNeeded('../utils/modLogStore');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('modconfig')
    .setDescription('Assign the moderator role and choose where mod actions are logged')
    .addRoleOption((opt) =>
      opt
        .setName('role')
        .setDescription('Role that can run moderation commands')
        .setRequired(false))
    .addChannelOption((opt) =>
      opt
        .setName('log_channel')
        .setDescription('Channel where moderation actions are logged')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false))
    .addBooleanOption((opt) =>
      opt
        .setName('clear_role')
        .setDescription('Remove the stored moderator role'))
    .addBooleanOption((opt) =>
      opt
        .setName('clear_channel')
        .setDescription('Remove the stored mod log channel'))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure the moderator settings.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const role = interaction.options.getRole('role') as any;
    const logChannel = interaction.options.getChannel('log_channel');
    const clearRole = interaction.options.getBoolean('clear_role');
    const clearChannel = interaction.options.getBoolean('clear_channel');

    if (!role && !logChannel && !clearRole && !clearChannel) {
      const config = await modLogStore.getConfig(interaction.guild.id);
      const parts = [
        `Moderator role: ${config.moderatorRoleId ? `<@&${config.moderatorRoleId}>` : 'Not set'}`,
        `Mod log channel: ${config.channelId ? `<#${config.channelId}>` : 'Not set'}`,
        'Mod actions (/ban /kick /mute /unban /unmute) require a reason',
      ];
      return interaction.editReply({ content: parts.join('\n') });
    }

    if (role && clearRole) {
      return interaction.editReply({ content: 'Specify either a role or clear it, not both.' });
    }
    if (logChannel && clearChannel) {
      return interaction.editReply({ content: 'Specify either a log channel or clear it, not both.' });
    }

    const changes: string[] = [];

    if (role) {
      if (role.guild.id !== interaction.guild.id) {
        return interaction.editReply({ content: 'Please choose a role from this server.' });
      }
      if (role.managed) {
        return interaction.editReply({ content: 'Please pick a regular role, not a managed one.' });
      }
      await modLogStore.setModeratorRole(interaction.guild.id, role.id);
      changes.push(`Moderator role -> ${role}`);
    } else if (clearRole) {
      await modLogStore.setModeratorRole(interaction.guild.id, null);
      changes.push('Moderator role -> not set');
    }

    if (logChannel) {
      await modLogStore.set(interaction.guild.id, logChannel.id);
      changes.push(`Mod log channel -> ${logChannel}`);
    } else if (clearChannel) {
      await modLogStore.set(interaction.guild.id, null);
      changes.push('Mod log channel -> not set');
    }

    if (!changes.length) {
      return interaction.editReply({ content: 'No configuration changes were provided.' });
    }

    return interaction.editReply({ content: `Updated: ${changes.join('; ')}` });
  },
};

export = command;
