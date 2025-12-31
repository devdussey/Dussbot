const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const reactionRoleStore = require('../utils/reactionRoleStore');
const reactionRoleManager = require('../utils/reactionRoleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrdelete')
    .setDescription('Delete a reaction role panel')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .setDMPermission(false)
    .addIntegerOption(opt =>
      opt
        .setName('id')
        .setDescription('Reaction role panel ID')
    )
    .addStringOption(opt =>
      opt
        .setName('message_id')
        .setDescription('Message ID that has the menu attached')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'You need Manage Roles to delete reaction roles.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const id = interaction.options.getInteger('id');
    const messageId = interaction.options.getString('message_id');
    if (!id && !messageId) {
      return interaction.editReply({ content: 'Provide a panel ID or message ID to delete.' });
    }

    let panel = null;
    if (id) panel = reactionRoleStore.getPanel(interaction.guildId, id);
    if (!panel && messageId) {
      panel = reactionRoleStore.findPanelByMessageId(interaction.guildId, messageId);
    }

    if (!panel) {
      return interaction.editReply({ content: 'No matching reaction role panel was found.' });
    }

    reactionRoleStore.removePanel(interaction.guildId, panel.id);

    let removedMenu = false;
    try {
      const channel = await interaction.guild.channels.fetch(panel.channelId);
      if (channel?.isTextBased?.()) {
        const message = await channel.messages.fetch(panel.messageId);
        if (message?.editable) {
          const res = reactionRoleManager.removeMenuRow(message.components, `rr:select:${panel.id}`);
          if (res.removed) {
            await message.edit({ components: res.rows });
            removedMenu = true;
          }
        }
      }
    } catch (_) {}

    const suffix = removedMenu ? '' : ' (menu not removed from the message)';
    return interaction.editReply({ content: `Removed reaction role panel #${panel.id}${suffix}.` });
  },
};
