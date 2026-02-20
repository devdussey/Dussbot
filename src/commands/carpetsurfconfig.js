const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const carpetSurfConfigStore = require('../utils/carpetSurfConfigStore');
const carpetSurfManager = require('../utils/carpetSurfManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carpetsurfconfig')
    .setDescription('Configure periodic CarpetSurf rounds')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set channel and interval, then enable CarpetSurf')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel where rounds will be posted')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true))
        .addIntegerOption(option =>
          option
            .setName('minutes')
            .setDescription('How often to post a round (in minutes)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1440)))
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable periodic CarpetSurf rounds'))
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('View CarpetSurf configuration and asset counts'))
    .addSubcommand(sub =>
      sub
        .setName('run')
        .setDescription('Run a CarpetSurf round now')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const me = interaction.guild.members.me;
      const perms = channel.permissionsFor(me);

      if (!channel?.isTextBased?.()) {
        return interaction.reply({ content: 'Please choose a text channel.', ephemeral: true });
      }
      if (!perms?.has(PermissionFlagsBits.ViewChannel)
        || !perms?.has(PermissionFlagsBits.SendMessages)
        || !perms?.has(PermissionFlagsBits.EmbedLinks)
        || !perms?.has(PermissionFlagsBits.AttachFiles)) {
        return interaction.reply({
          content: `I need View Channel, Send Messages, Embed Links, and Attach Files in ${channel}.`,
          ephemeral: true,
        });
      }

      const config = carpetSurfConfigStore.setConfig(interaction.guildId, {
        enabled: true,
        channelId: channel.id,
        intervalMinutes: minutes,
      });
      await carpetSurfManager.reloadGuild(interaction.client, interaction.guildId);

      return interaction.reply({
        content: `CarpetSurf enabled in ${channel}. A new round will post every **${config.intervalMinutes} minute${config.intervalMinutes === 1 ? '' : 's'}**.`,
        ephemeral: true,
      });
    }

    if (sub === 'disable') {
      carpetSurfConfigStore.setConfig(interaction.guildId, { enabled: false });
      await carpetSurfManager.reloadGuild(interaction.client, interaction.guildId);
      return interaction.reply({ content: 'CarpetSurf has been disabled for this server.', ephemeral: true });
    }

    if (sub === 'status') {
      const config = carpetSurfConfigStore.getConfig(interaction.guildId);
      const counts = carpetSurfManager.getAssetCounts();
      const channelLine = config.channelId ? `<#${config.channelId}>` : 'Not set';
      const enabledLine = config.enabled ? 'Enabled' : 'Disabled';
      const content = [
        `Status: **${enabledLine}**`,
        `Channel: ${channelLine}`,
        `Interval: **${config.intervalMinutes}** minute${config.intervalMinutes === 1 ? '' : 's'}`,
        `Assets: unmarked **${counts.correctUnmarked}**, marked **${counts.correctMarked}**, incorrect **${counts.incorrect}**`,
        'Round rules: 4 pictures, 15 seconds, button guesses, correct users get 1 Rupee.',
      ].join('\n');
      return interaction.reply({ content, ephemeral: true });
    }

    if (sub === 'run') {
      await interaction.deferReply({ ephemeral: true });
      const result = await carpetSurfManager.runNow(interaction.client, interaction.guildId);
      if (!result.ok) {
        return interaction.editReply({ content: result.error || 'Could not start a CarpetSurf round right now.' });
      }
      return interaction.editReply({ content: 'CarpetSurf round started.' });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
