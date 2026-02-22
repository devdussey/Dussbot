import path from 'node:path';
import {
  PermissionsBitField,
  Role,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
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

const cmdLogger = requireFromSrcIfNeeded('../utils/logger')('owner');
const { isOwner } = requireFromSrcIfNeeded('../utils/ownerIds');

async function resolveAdminRole(interaction: ChatInputCommandInteraction): Promise<Role | null> {
  if (!interaction.guild) return null;

  const requestedRole = interaction.options.getRole('role');
  if (requestedRole instanceof Role) return requestedRole;

  const namedMatch = interaction.guild.roles.cache.find((role) => {
    const name = role.name.trim().toLowerCase();
    return name === 'admin' || name === 'administrator';
  });
  if (namedMatch) return namedMatch;

  try {
    return await interaction.guild.roles.create({
      name: 'Admin',
      permissions: [PermissionsBitField.Flags.Administrator],
      reason: `/owner config invoked by bot owner ${interaction.user.tag} (${interaction.user.id})`,
    });
  } catch (err) {
    cmdLogger.error('Failed to create Admin role:', err);
    return null;
  }
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Bot owner controls')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config')
        .setDescription('Assign an admin role to a user')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to grant the admin role to')
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Existing role to assign (defaults to Admin/Administrator role)'),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: 'Only the bot owner can run this command.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'config') {
      return interaction.reply({ content: 'Unsupported owner action.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user', true);
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    }

    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'I need **Manage Roles** permission to do that.', ephemeral: true });
    }

    const adminRole = await resolveAdminRole(interaction);
    if (!adminRole) {
      return interaction.reply({
        content: 'I could not resolve or create an admin role. Check my role permissions and hierarchy.',
        ephemeral: true,
      });
    }

    if (botMember.roles.highest.comparePositionTo(adminRole) <= 0) {
      return interaction.reply({
        content: `I cannot assign ${adminRole} because it is higher than or equal to my highest role.`,
        ephemeral: true,
      });
    }

    if (targetMember.roles.cache.has(adminRole.id)) {
      return interaction.reply({ content: `${targetMember} already has ${adminRole}.`, ephemeral: true });
    }

    try {
      await targetMember.roles.add(
        adminRole,
        `/owner config invoked by bot owner ${interaction.user.tag} (${interaction.user.id})`,
      );
      return interaction.reply({ content: `Granted ${adminRole} to ${targetMember}.`, ephemeral: true });
    } catch (err) {
      cmdLogger.error('Failed to assign admin role:', err);
      return interaction.reply({ content: 'Failed to assign the admin role.', ephemeral: true });
    }
  },
};

export = command;
