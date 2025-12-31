const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const reactionRoleStore = require('../utils/reactionRoleStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrlist')
    .setDescription('List reaction role panels for this server')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'You need Manage Roles to view reaction roles.', ephemeral: true });
    }

    const panels = reactionRoleStore.listPanels(interaction.guildId);
    if (!panels.length) {
      return interaction.reply({ content: 'No reaction role panels configured yet.', ephemeral: true });
    }

    const lines = panels.map(panel => {
      const mode = panel.multi ? 'multi' : 'single';
      const link = `https://discord.com/channels/${interaction.guildId}/${panel.channelId}/${panel.messageId}`;
      const roles = panel.roleIds.length ? panel.roleIds.map(id => `<@&${id}>`).join(', ') : 'None';
      return `#${panel.id} | ${mode} | <#${panel.channelId}> | ${link}\n    Roles: ${roles}`;
    });

    const content = lines.join('\n').slice(0, 1900);
    return interaction.reply({ content, ephemeral: true });
  },
};
