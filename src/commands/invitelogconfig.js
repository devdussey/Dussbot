const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');

const LOG_KEY = 'invite';

function formatStatus(enabled) {
  return enabled ? 'enabled' : 'disabled';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invitelogconfig')
    .setDescription('Configure invite log routing')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption(option =>
      option
        .setName('status')
        .setDescription('Enable or disable invite logs')
        .setRequired(true)
        .addChoices(
          { name: 'enable', value: 'enable' },
          { name: 'disable', value: 'disable' },
        ))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where invite logs should be posted')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure invite logs.', ephemeral: true });
    }

    const status = interaction.options.getString('status', true);
    const channel = interaction.options.getChannel('channel', false);
    const enable = status === 'enable';

    let existingEntry = null;
    try {
      existingEntry = await logChannelTypeStore.getEntry(interaction.guildId, LOG_KEY);
    } catch (err) {
      console.error('Failed to read invite log config:', err);
    }

    if (enable && !channel && !existingEntry?.channelId) {
      return interaction.reply({
        content: 'Please select a channel to enable invite logs.',
        ephemeral: true,
      });
    }

    if (channel) {
      if (!channel.isTextBased?.()) {
        return interaction.reply({ content: 'Please choose a text-based channel.', ephemeral: true });
      }
      const me = interaction.guild?.members?.me || await interaction.guild?.members?.fetchMe().catch(() => null);
      if (me) {
        const required = [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
        ];
        const perms = channel.permissionsFor(me);
        if (!perms || !perms.has(required)) {
          return interaction.reply({
            content: `I need View Channel, Send Messages, and Embed Links permissions in ${channel}.`,
            ephemeral: true,
          });
        }
      }
    }

    try {
      if (channel) {
        await logChannelTypeStore.setChannel(interaction.guildId, LOG_KEY, channel.id);
      }
      await logChannelTypeStore.setEnabled(interaction.guildId, LOG_KEY, enable);
    } catch (err) {
      console.error('Failed to update invite log config:', err);
      return interaction.reply({ content: 'Failed to update invite log configuration.', ephemeral: true });
    }

    const targetChannelId = channel?.id || existingEntry?.channelId;
    const channelText = targetChannelId ? `<#${targetChannelId}>` : 'No channel set';

    return interaction.reply({
      content: `Invite logs are now **${formatStatus(enable)}**. Channel: ${channelText}.`,
      ephemeral: true,
    });
  },
};
