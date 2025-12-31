const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const sentenceRushGameManager = require('../utils/sentenceRushGameManager');
const sentenceRushConfigStore = require('../utils/sentenceRushConfigStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sentancerush')
    .setDescription('Play SentenceRush: guess the hidden sentence (turn-based).')
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start a SentenceRush lobby in this channel (30s join button)'))
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('Stop the active SentenceRush game in this channel'))
    .addSubcommand(sub =>
      sub
        .setName('settings')
        .setDescription('Update SentenceRush settings for this server')
        .addIntegerOption(option =>
          option
            .setName('min_words')
            .setDescription('Minimum words per sentence (3-8)')
            .setMinValue(3)
            .setMaxValue(8))
        .addIntegerOption(option =>
          option
            .setName('max_words')
            .setDescription('Maximum words per sentence (3-8)')
            .setMinValue(3)
            .setMaxValue(8))
        .addIntegerOption(option =>
          option
            .setName('turn_seconds')
            .setDescription('Seconds per turn (30-60)')
            .setMinValue(30)
            .setMaxValue(60))),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server channel.', ephemeral: true });
    }

    const channel = interaction.channel;
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
      return interaction.reply({ content: 'SentenceRush can only run in text-based channels.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'start') {
      const mePermissions = channel.permissionsFor(interaction.client.user);
      if (!mePermissions?.has(PermissionsBitField.Flags.SendMessages)) {
        return interaction.reply({ content: 'I need permission to send messages in this channel to host SentenceRush.', ephemeral: true });
      }
      if (!mePermissions?.has(PermissionsBitField.Flags.EmbedLinks)) {
        return interaction.reply({ content: 'I need the Embed Links permission in this channel to host SentenceRush.', ephemeral: true });
      }

      const result = await sentenceRushGameManager.startSentenceRushGame(interaction);
      if (!result.ok) {
        return interaction.reply({ content: result.error || 'Unable to start SentenceRush right now.', ephemeral: true });
      }

      return interaction.reply({
        content: `SentenceRush lobby started in ${channel}. Click **Join SentenceRush** in chat (30s). Turn timer: **${result.game.turnSeconds}s**.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'end') {
      const game = sentenceRushGameManager.getActiveGame(interaction.guildId, interaction.channelId);
      if (!game) {
        return interaction.reply({ content: 'There is no active SentenceRush game in this channel.', ephemeral: true });
      }

      const canStop = interaction.user.id === game.hostId
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers);

      if (!canStop) {
        return interaction.reply({ content: 'Only the host or a server moderator can stop this SentenceRush game.', ephemeral: true });
      }

      const stopped = sentenceRushGameManager.stopSentenceRushGame(interaction.guildId, interaction.channelId, 'stopped');
      if (!stopped) {
        return interaction.reply({ content: 'The SentenceRush game could not be stopped.', ephemeral: true });
      }

      return interaction.reply({ content: 'Stopping SentenceRush.', ephemeral: true });
    }

    if (subcommand === 'settings') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'Manage Server permission is required to update SentenceRush settings.', ephemeral: true });
      }

      const minWords = interaction.options.getInteger('min_words');
      const maxWords = interaction.options.getInteger('max_words');
      const turnSeconds = interaction.options.getInteger('turn_seconds');

      if (minWords === null && maxWords === null && turnSeconds === null) {
        const current = sentenceRushConfigStore.getConfig(interaction.guildId);
        return interaction.reply({
          content: `SentenceRush settings: min words **${current.minWords}**, max words **${current.maxWords}**, turn timer **${current.turnSeconds}s**.`,
          ephemeral: true,
        });
      }

      const updates = {};
      if (minWords !== null) updates.minWords = minWords;
      if (maxWords !== null) updates.maxWords = maxWords;
      if (turnSeconds !== null) updates.turnSeconds = turnSeconds;

      const updated = sentenceRushConfigStore.setConfig(interaction.guildId, updates);

      return interaction.reply({
        content: `SentenceRush settings updated: min words **${updated.minWords}**, max words **${updated.maxWords}**, turn timer **${updated.turnSeconds}s**.`,
        ephemeral: true,
      });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
