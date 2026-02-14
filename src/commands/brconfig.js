const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const boosterConfigStore = require('../utils/boosterRoleConfigStore');
const { postBoosterRolePanel } = require('../utils/boosterRolePanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boosterroleconfig')
    .setDescription('Post the booster role configuration panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the booster role setup panel in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased?.()) {
      return interaction.reply({ content: 'Please choose a text-based channel.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ content: `I cannot send messages in ${channel}.`, ephemeral: true });
    }

    try {
      const priorPanel = await boosterConfigStore.getPanel(interaction.guildId);
      if (priorPanel?.channelId && priorPanel?.messageId && priorPanel.channelId !== channel.id) {
        try {
          const oldChannel = await interaction.guild.channels.fetch(priorPanel.channelId);
          if (oldChannel?.isTextBased?.()) {
            const oldMessage = await oldChannel.messages.fetch(priorPanel.messageId);
            if (oldMessage) await oldMessage.delete();
          }
        } catch (_) {}
      }

      const previousMessageId = priorPanel?.channelId === channel.id ? priorPanel?.messageId : null;
      const sent = await postBoosterRolePanel(channel, previousMessageId);
      await boosterConfigStore.setPanel(interaction.guildId, channel.id, sent.id);
    } catch (error) {
      return interaction.reply({ content: `Failed to send the booster role panel: ${error.message}`, ephemeral: true });
    }

    return interaction.reply({ content: `Sent booster role panel to ${channel}.`, ephemeral: true });
  },
};
