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

const modlog = requireFromSrcIfNeeded('../utils/modLogger');
const roleCleanManager = requireFromSrcIfNeeded('../utils/roleCleanManager');

function normalizeColor(input: string | null) {
  if (!input) return null;
  const str = String(input).trim();
  const match = str.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
}

function buildAuditReason(interaction: ChatInputCommandInteraction, action: string) {
  return `By ${interaction.user.tag} (${interaction.user.id}) via /role ${action}`;
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Create, delete, or edit server roles (admin only)')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new role with an optional colour')
        .addStringOption((opt) =>
          opt.setName('name')
            .setDescription('Role name')
            .setRequired(true))
        .addStringOption((opt) =>
          opt.setName('colour')
            .setDescription('Hex colour (6 digits, e.g. #5865F2 or 5865F2)')
            .setRequired(false)))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete an existing role')
        .addRoleOption((opt) =>
          opt.setName('role')
            .setDescription('Role to delete')
            .setRequired(true)))
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit a role name or colour')
        .addRoleOption((opt) =>
          opt.setName('role')
            .setDescription('Role to update')
            .setRequired(true))
        .addStringOption((opt) =>
          opt.setName('name_edit')
            .setDescription('New role name')
            .setRequired(false))
        .addStringOption((opt) =>
          opt.setName('colour_edit')
            .setDescription('New hex colour (6 digits)')
            .setRequired(false)))
    .addSubcommand((sub) =>
      sub
        .setName('clean')
        .setDescription('List empty roles and delete them individually or in bulk')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'I need the Manage Roles permission to manage roles.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'clean') {
      return roleCleanManager.openRoleCleanup(interaction);
    }

    const auditReason = buildAuditReason(interaction, sub);

    try {
      if (sub === 'create') {
        const rawName = (interaction.options.getString('name', true) || '').trim();
        if (!rawName) {
          return interaction.reply({ content: 'Provide a valid role name.', ephemeral: true });
        }
        const name = rawName.slice(0, 100);
        const colourInput = interaction.options.getString('colour');
        const colour = normalizeColor(colourInput);
        if (colourInput && !colour) {
          return interaction.reply({ content: 'Invalid colour. Use a 6-digit hex value, optionally prefixed with #.', ephemeral: true });
        }

        const role = await interaction.guild.roles.create({
          name,
          color: (colour as any) ?? undefined,
          reason: auditReason,
        });

        try {
          await modlog.log(interaction, 'Role Created', {
            target: `${role} (${role.id})`,
            reason: colour ? `Colour: ${colour}` : 'Default colour',
          });
        } catch (_) {}

        return interaction.reply({ content: `Created role ${role.toString()}.`, ephemeral: true });
      }

      const role = interaction.options.getRole('role', true) as any;
      if (!role) {
        return interaction.reply({ content: 'Please select a role.', ephemeral: true });
      }

      if (role.id === interaction.guild.id) {
        return interaction.reply({ content: 'The @everyone role cannot be modified using this command.', ephemeral: true });
      }
      if (role.managed) {
        return interaction.reply({ content: 'Managed roles cannot be modified via this command.', ephemeral: true });
      }
      if (me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ content: 'My highest role must be above the target role to make changes.', ephemeral: true });
      }

      const requesterMember = await interaction.guild.members.fetch(interaction.user.id);
      if (requesterMember.roles.highest.comparePositionTo(role) <= 0 && interaction.guild.ownerId !== interaction.user.id) {
        return interaction.reply({ content: 'Your highest role must be above the target role to modify it.', ephemeral: true });
      }

      if (sub === 'delete') {
        await role.delete({ reason: auditReason });
        try {
          await modlog.log(interaction, 'Role Deleted', {
            target: `${role.name} (${role.id})`,
          });
        } catch (_) {}
        return interaction.reply({ content: `Deleted role "${role.name}".`, ephemeral: true });
      }

      if (sub === 'edit') {
        const nameEdit = interaction.options.getString('name_edit');
        const colourInput = interaction.options.getString('colour_edit');
        const updated: Record<string, string> = {};

        if (nameEdit) {
          const trimmed = nameEdit.trim();
          if (!trimmed) {
            return interaction.reply({ content: 'Role name cannot be empty.', ephemeral: true });
          }
          updated.name = trimmed.slice(0, 100);
        }

        if (colourInput) {
          const colour = normalizeColor(colourInput);
          if (!colour) {
            return interaction.reply({ content: 'Invalid colour. Use a 6-digit hex value, optionally prefixed with #.', ephemeral: true });
          }
          updated.color = colour;
        }

        if (!Object.keys(updated).length) {
          return interaction.reply({ content: 'Provide at least one property to update (name or colour).', ephemeral: true });
        }

        const payload: any = { ...updated, reason: auditReason };
        await role.edit(payload);
        try {
          await modlog.log(interaction, 'Role Updated', {
            target: `${role} (${role.id})`,
            reason: `Updated fields: ${Object.keys(updated).join(', ')}`,
          });
        } catch (_) {}

        return interaction.reply({
          content: `Updated role ${role.toString()} with ${Object.keys(updated).join(', ')}.`,
          ephemeral: true,
        });
      }

      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return interaction.reply({ content: `Failed to ${sub} role: ${message}`, ephemeral: true });
    }
  },
};

export = command;
