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
const store = requireFromSrcIfNeeded('../utils/autorolesStore');

const targetOptions = [
  { name: 'All joins (members + bots)', value: 'all' },
  { name: 'Humans only', value: 'member' },
  { name: 'Bots only', value: 'bot' },
];

const targetLabels: Record<string, string> = {
  all: 'all joining members',
  member: 'human members only',
  bot: 'bots only',
};

const targetTitles: Record<string, string> = {
  all: 'All joins (members + bots)',
  member: 'Humans only',
  bot: 'Bots only',
};

function formatRoleList(guild: any, ids: string[]) {
  return ids
    .map((id) => {
      const role = guild.roles.cache.get(id);
      return role ? `<@&${role.id}>` : `Unknown(${id})`;
    })
    .join(', ');
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('autoroles')
    .setDescription('Configure automatic roles for new members')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a role to autoroles')
        .addRoleOption((opt) =>
          opt.setName('role')
            .setDescription('Role to auto-assign on join')
            .setRequired(true))
        .addStringOption((opt) =>
          opt.setName('target')
            .setDescription('Who should receive this autorole (default is every join)')
            .addChoices(...targetOptions)))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a role from autoroles')
        .addRoleOption((opt) =>
          opt.setName('role')
            .setDescription('Role to remove')
            .setRequired(true))
        .addStringOption((opt) =>
          opt.setName('target')
            .setDescription('Which autorole list to remove from (defaults to shared list)')
            .addChoices(...targetOptions)))
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List current autoroles'))
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Clear all autoroles')
        .addStringOption((opt) =>
          opt.setName('target')
            .setDescription('Limit clearing to a specific target list')
            .addChoices(...targetOptions))),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await logger.logPermissionDenied(interaction, 'autoroles', 'Bot missing Manage Roles');
      return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      await logger.logPermissionDenied(interaction, 'autoroles', 'User missing Manage Roles');
      return interaction.reply({ content: 'You need Manage Roles to configure autoroles.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const role = interaction.options.getRole('role', true) as any;
      const target = interaction.options.getString('target') || 'all';
      const targetLabel = targetLabels[target] || targetLabels.all;

      if (role.managed) {
        await logger.logHierarchyViolation(interaction, 'autoroles add', { tag: role.name, id: role.id }, 'Managed role');
        return interaction.reply({ content: 'That role is managed and cannot be assigned by bots.', ephemeral: true });
      }
      if (me.roles.highest.comparePositionTo(role) <= 0) {
        await logger.logHierarchyViolation(interaction, 'autoroles add', { tag: role.name, id: role.id }, 'Bot role not high enough');
        return interaction.reply({ content: 'My role must be higher than the target role.', ephemeral: true });
      }

      const added = store.addGuildRole(interaction.guild.id, role.id, target);
      return interaction.reply({
        content: added
          ? `Added <@&${role.id}> to autoroles for ${targetLabel}.`
          : `<@&${role.id}> is already configured for ${targetLabel}.`,
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role', true) as any;
      const target = interaction.options.getString('target') || 'all';
      const targetLabel = targetLabels[target] || targetLabels.all;
      const removed = store.removeGuildRole(interaction.guild.id, role.id, target);
      return interaction.reply({
        content: removed ? `Removed <@&${role.id}> from autoroles for ${targetLabel}.` : `<@&${role.id}> was not configured for ${targetLabel}.`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const allIds = store.getGuildRoles(interaction.guild.id, 'all');
      const humanIds = store.getGuildRoles(interaction.guild.id, 'member');
      const botIds = store.getGuildRoles(interaction.guild.id, 'bot');
      const sections: string[] = [];
      if (allIds.length) sections.push(`**${targetTitles.all}**: ${formatRoleList(interaction.guild, allIds)}`);
      if (humanIds.length) sections.push(`**${targetTitles.member}**: ${formatRoleList(interaction.guild, humanIds)}`);
      if (botIds.length) sections.push(`**${targetTitles.bot}**: ${formatRoleList(interaction.guild, botIds)}`);
      if (!sections.length) return interaction.reply({ content: 'No autoroles configured.', ephemeral: true });
      return interaction.reply({ content: `Autoroles:\n${sections.join('\n\n')}`, ephemeral: true });
    }

    if (sub === 'clear') {
      const target = interaction.options.getString('target');
      if (target) {
        store.clearGuildRoles(interaction.guild.id, target);
        const targetLabel = targetLabels[target] || targetLabels.all;
        return interaction.reply({ content: `Cleared autoroles configured for ${targetLabel}.`, ephemeral: true });
      }
      store.clearGuildRoles(interaction.guild.id);
      return interaction.reply({ content: 'Cleared all autoroles for this server.', ephemeral: true });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};

export = command;
