const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, escapeMarkdown } = require('discord.js');
const wordRushGameManager = require('../utils/wordRushGameManager');
const wordRushStatsStore = require('../utils/wordRushStatsStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

async function resolveDisplayName(guild, userId) {
  if (!guild) return `User ${userId}`;
  try {
    const member = await guild.members.fetch(userId);
    const display = member.displayName || member.user.globalName || member.user.username;
    return display ? escapeMarkdown(display) : `User ${userId}`;
  } catch (err) {
    try {
      const user = await guild.client.users.fetch(userId);
      const name = user.globalName || user.username;
      return name ? escapeMarkdown(name) : `User ${userId}`;
    } catch (_) {
      return `User ${userId}`;
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordrush')
    .setDescription('Play WordRush: build words from ordered letters (turn-based).')
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start a WordRush lobby in this channel (30s join button)')
        .addIntegerOption(option =>
          option
            .setName('turn_seconds')
            .setDescription('Seconds per turn (default 10)')
            .setMinValue(5)
            .setMaxValue(60)))
    .addSubcommand(sub =>
      sub
        .setName('join')
        .setDescription('Join the active WordRush lobby in this channel'))
    .addSubcommand(sub =>
      sub
        .setName('leave')
        .setDescription('Leave the active WordRush game in this channel'))
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Stop the active WordRush game in this channel'))
    .addSubcommand(sub =>
      sub
        .setName('stats')
        .setDescription('View WordRush wins for a user')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to view (default: you)')))
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('View this server’s WordRush leaderboard')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server channel.', ephemeral: true });
    }

    const channel = interaction.channel;
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
      return interaction.reply({ content: 'WordRush can only run in text-based channels.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
      const mePermissions = channel.permissionsFor(interaction.client.user);
      if (!mePermissions?.has(PermissionsBitField.Flags.SendMessages)) {
        return interaction.reply({ content: 'I need permission to send messages in this channel to host WordRush.', ephemeral: true });
      }

      const turnSeconds = interaction.options.getInteger('turn_seconds');

      const result = await wordRushGameManager.startWordRushGame(interaction, { turnSeconds });
      if (!result.ok) {
        return interaction.reply({ content: result.error || 'Unable to start WordRush right now.', ephemeral: true });
      }

      return interaction.reply({
        content: `WordRush lobby started in ${channel}. Click **Join WordRush** in chat (30s). Lives: **2** each. Turn timer: **${result.game.turnSeconds}s**.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'join') {
      const game = wordRushGameManager.getActiveGame(interaction.guildId, interaction.channelId);
      if (!game) {
        return interaction.reply({ content: 'There is no active WordRush game in this channel. Start one with `/wordrush start`.', ephemeral: true });
      }

      const joined = wordRushGameManager.joinWordRushGame(game, interaction.user);
      if (!joined.ok) {
        return interaction.reply({ content: joined.error || 'Unable to join WordRush right now.', ephemeral: true });
      }

      if (!joined.joined) {
        return interaction.reply({ content: 'You are already in this WordRush game.', ephemeral: true });
      }

      try {
        await channel.send({ content: `<@${interaction.user.id}> joined WordRush!` });
      } catch (_) {}

      return interaction.reply({ content: 'Joined WordRush.', ephemeral: true });
    }

    if (subcommand === 'leave') {
      const game = wordRushGameManager.getActiveGame(interaction.guildId, interaction.channelId);
      if (!game) {
        return interaction.reply({ content: 'There is no active WordRush game in this channel.', ephemeral: true });
      }

      const left = wordRushGameManager.leaveWordRushGame(game, interaction.user.id);
      if (!left.ok) {
        return interaction.reply({ content: left.error || 'Unable to leave WordRush right now.', ephemeral: true });
      }

      if (!left.left) {
        return interaction.reply({ content: 'You are not in this WordRush game.', ephemeral: true });
      }

      try {
        await channel.send({ content: `<@${interaction.user.id}> left WordRush.` });
      } catch (_) {}

      return interaction.reply({ content: 'Left WordRush.', ephemeral: true });
    }

    if (subcommand === 'stop') {
      const game = wordRushGameManager.getActiveGame(interaction.guildId, interaction.channelId);
      if (!game) {
        return interaction.reply({ content: 'There is no active WordRush game in this channel.', ephemeral: true });
      }

      const canStop = interaction.user.id === game.hostId
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)
        || interaction.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers);

      if (!canStop) {
        return interaction.reply({ content: 'Only the host or a server moderator can stop this WordRush game.', ephemeral: true });
      }

      const stopped = wordRushGameManager.stopWordRushGame(interaction.guildId, interaction.channelId, 'stopped');
      if (!stopped) {
        return interaction.reply({ content: 'The WordRush game could not be stopped.', ephemeral: true });
      }

      return interaction.reply({ content: 'Stopping WordRush…', ephemeral: true });
    }

    if (subcommand === 'stats') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const stats = wordRushStatsStore.getStats(interaction.guildId, targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(resolveEmbedColour(interaction.guildId, 0x5865F2))
        .setTitle('WordRush Stats')
        .setDescription(`Stats for **${escapeMarkdown(targetUser.globalName || targetUser.username || targetUser.id)}**`)
        .addFields(
          { name: 'Wins', value: String(stats.wins), inline: true },
          { name: 'Games Played', value: String(stats.gamesPlayed), inline: true },
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'leaderboard') {
      await interaction.deferReply();

      const leaderboard = wordRushStatsStore.getLeaderboard(interaction.guildId);
      if (!leaderboard.length) {
        return interaction.editReply({ content: 'No WordRush games have been recorded yet. Start one with `/wordrush start`!' });
      }

      const topEntries = leaderboard.slice(0, 10);
      const resolved = await Promise.all(topEntries.map(async (entry, index) => ({
        ...entry,
        name: await resolveDisplayName(interaction.guild, entry.userId),
        index,
      })));

      const lines = resolved.map(entry => `${entry.index + 1}. **${entry.name}** - ${entry.wins} win${entry.wins === 1 ? '' : 's'} (${entry.gamesPlayed} game${entry.gamesPlayed === 1 ? '' : 's'})`);

      const embed = new EmbedBuilder()
        .setColor(resolveEmbedColour(interaction.guildId, 0x5865F2))
        .setTitle('WordRush Leaderboard')
        .setDescription(lines.join('\n'));

      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
