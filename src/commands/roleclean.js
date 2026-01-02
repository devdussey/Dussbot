const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { applyDefaultColour } = require('../utils/guildColourStore');

const MAX_ROLE_BUTTONS = 20; // keeps us under the 25 component limit after control buttons

function canUserManageRole(member, role) {
  if (!member || !role) return false;
  if (member.guild?.ownerId === member.id) return true;
  return member.roles?.highest?.comparePositionTo(role) > 0;
}

async function collectEmptyRoles(guild, requester) {
  await guild.roles.fetch();
  try {
    // Fetch all members so role membership counts are accurate before deleting
    await guild.members.fetch();
  } catch (err) {
    throw new Error('Could not load members. Enable the Server Members Intent to safely check empty roles.');
  }

  const me = guild.members.me || await guild.members.fetchMe();
  if (!me) throw new Error('Could not load my member data.');

  const roles = [];
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue; // @everyone
    if (role.managed) continue; // integrations
    if (role.members.size > 0) continue; // has users
    if (me.roles.highest.comparePositionTo(role) <= 0) continue; // bot cannot delete
    if (!canUserManageRole(requester, role)) continue; // requester cannot delete
    roles.push(role);
  }

  roles.sort((a, b) => b.position - a.position || a.id.localeCompare(b.id));
  return roles;
}

function buildRoleListField(roles) {
  if (!roles.length) return 'No empty, manageable roles found.';
  const lines = roles.map(r => `${r} (\`${r.id}\`)`);
  return lines.join('\n');
}

function buildComponents(emptyRoles, ownerId) {
  const components = [];
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`roleclean:deleteall:${ownerId}`)
      .setLabel('Delete All')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(emptyRoles.length === 0),
    new ButtonBuilder()
      .setCustomId(`roleclean:refresh:${ownerId}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );
  components.push(controlRow);

  const roleButtons = emptyRoles.slice(0, MAX_ROLE_BUTTONS).map(role =>
    new ButtonBuilder()
      .setCustomId(`roleclean:delete:${ownerId}:${role.id}`)
      .setLabel(role.name.slice(0, 80))
      .setStyle(ButtonStyle.Danger),
  );

  for (let i = 0; i < roleButtons.length; i += 5) {
    const row = new ActionRowBuilder().addComponents(roleButtons.slice(i, i + 5));
    components.push(row);
  }

  return components;
}

function buildEmbed(guildId, emptyRoles) {
  const embed = new EmbedBuilder()
    .setTitle('Role Cleanup')
    .setDescription(emptyRoles.length
      ? 'These roles have no members. Delete them individually or wipe them all.'
      : 'No empty roles that I can manage were found.')
    .addFields({
      name: emptyRoles.length ? `Empty roles (${Math.min(emptyRoles.length, MAX_ROLE_BUTTONS)} shown)` : 'Status',
      value: buildRoleListField(emptyRoles.slice(0, MAX_ROLE_BUTTONS)),
    })
    .setFooter({ text: emptyRoles.length > MAX_ROLE_BUTTONS ? `Showing first ${MAX_ROLE_BUTTONS} roles. Delete All affects every empty role I can manage.` : ' ' })
    .setTimestamp();

  try { applyDefaultColour(embed, guildId); } catch (_) {}
  return embed;
}

async function buildView(guild, requester) {
  const emptyRoles = await collectEmptyRoles(guild, requester);
  const embed = buildEmbed(guild.id, emptyRoles);
  const components = buildComponents(emptyRoles, requester.id);
  return { embed, components, emptyRoles };
}

async function handleDeleteOne(interaction, ownerId, roleId) {
  if (ownerId && interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Only the requester can use these buttons.', ephemeral: true });
  }
  if (!interaction.inGuild()) return;

  const me = interaction.guild.members.me;
  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'I need the Manage Roles permission to delete roles.', ephemeral: true });
  }
  if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'You need Manage Roles to use this.', ephemeral: true });
  }

  await interaction.deferUpdate();

  let role = null;
  try { role = await interaction.guild.roles.fetch(roleId); } catch (_) {}
  if (!role) {
    try { await interaction.followUp({ content: 'That role no longer exists.', ephemeral: true }); } catch (_) {}
  } else if (role.id === interaction.guild.id || role.managed) {
    try { await interaction.followUp({ content: 'That role cannot be deleted.', ephemeral: true }); } catch (_) {}
  } else if (role.members.size > 0) {
    try { await interaction.followUp({ content: 'That role is no longer empty.', ephemeral: true }); } catch (_) {}
  } else if (me.roles.highest.comparePositionTo(role) <= 0 || !canUserManageRole(interaction.member, role)) {
    try { await interaction.followUp({ content: 'Role hierarchy prevents deleting that role.', ephemeral: true }); } catch (_) {}
  } else {
    const reason = `Role clean by ${interaction.user.tag} (${interaction.user.id})`;
    try {
      await role.delete({ reason });
      try { await interaction.followUp({ content: `Deleted role ${role.name}.`, ephemeral: true }); } catch (_) {}
    } catch (err) {
      try { await interaction.followUp({ content: `Failed to delete ${role.name}: ${err?.message || 'Unknown error'}`, ephemeral: true }); } catch (_) {}
    }
  }

  try {
    const view = await buildView(interaction.guild, interaction.member);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
  } catch (err) {
    await interaction.editReply({ content: err.message || 'Failed to refresh empty roles.', components: [] });
  }
}

async function handleDeleteAll(interaction, ownerId) {
  if (ownerId && interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Only the requester can use these buttons.', ephemeral: true });
  }
  if (!interaction.inGuild()) return;

  const me = interaction.guild.members.me;
  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'I need the Manage Roles permission to delete roles.', ephemeral: true });
  }
  if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'You need Manage Roles to use this.', ephemeral: true });
  }

  await interaction.deferUpdate();

  let emptyRoles = [];
  try {
    emptyRoles = await collectEmptyRoles(interaction.guild, interaction.member);
  } catch (err) {
    await interaction.editReply({ content: err.message || 'Could not fetch roles.', components: [] });
    return;
  }

  if (!emptyRoles.length) {
    await interaction.followUp({ content: 'No empty, manageable roles to delete.', ephemeral: true });
  } else {
    const failures = [];
    for (const role of emptyRoles) {
      try {
        await role.delete({ reason: `Role clean (delete all) by ${interaction.user.tag} (${interaction.user.id})` });
      } catch (err) {
        failures.push(`${role.name}: ${err?.message || 'unknown error'}`);
      }
    }
    const summary = failures.length
      ? `Deleted ${emptyRoles.length - failures.length} roles. Failed: ${failures.join('; ')}`
      : `Deleted ${emptyRoles.length} empty role${emptyRoles.length === 1 ? '' : 's'}.`;
    await interaction.followUp({ content: summary, ephemeral: true });
  }

  try {
    const view = await buildView(interaction.guild, interaction.member);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
  } catch (err) {
    await interaction.editReply({ content: err.message || 'Failed to refresh empty roles.', components: [] });
  }
}

async function handleRefresh(interaction, ownerId) {
  if (ownerId && interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Only the requester can use these buttons.', ephemeral: true });
  }
  if (!interaction.inGuild()) return;

  const me = interaction.guild.members.me;
  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'I need the Manage Roles permission to refresh this list.', ephemeral: true });
  }
  if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'You need Manage Roles to use this.', ephemeral: true });
  }

  await interaction.deferUpdate();
  try {
    const view = await buildView(interaction.guild, interaction.member);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
  } catch (err) {
    await interaction.editReply({ content: err.message || 'Failed to refresh empty roles.', components: [] });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleclean')
    .setDescription('List roles with no members and delete them in bulk or one by one'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'I need the Manage Roles permission to delete roles.', ephemeral: true });
    }
    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'You need Manage Roles to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const view = await buildView(interaction.guild, interaction.member);
      await interaction.editReply({ embeds: [view.embed], components: view.components });
    } catch (err) {
      await interaction.editReply({ content: err.message || 'Failed to find empty roles.', components: [] });
    }
  },

  async handleRoleCleanButton(interaction) {
    if (typeof interaction.customId !== 'string') return;
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const ownerId = parts[2] || null;

    if (action === 'delete') {
      const roleId = parts[3];
      if (!roleId) return;
      return handleDeleteOne(interaction, ownerId, roleId);
    }
    if (action === 'deleteall') {
      return handleDeleteAll(interaction, ownerId);
    }
    if (action === 'refresh') {
      return handleRefresh(interaction, ownerId);
    }
  },
};
