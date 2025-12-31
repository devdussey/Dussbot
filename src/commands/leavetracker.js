const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, PermissionsBitField } = require('discord.js');
const leaveTrackerStore = require('../utils/leaveTrackerStore');
const { buildLeaveEmbed } = require('../utils/leaveTrackerEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leavetracker')
    .setDescription('Configure leave tracking embeds for members who depart')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Enable leave tracking and pick a channel for the embeds')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to post leave tracker embeds')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show the current leave tracker configuration')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable leave tracking without clearing saved settings')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure leave tracking.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      const channel = interaction.options.getChannel('channel', true);
      if (!channel.isTextBased?.()) {
        return interaction.reply({ content: 'Pick a text channel where I can post embeds.', ephemeral: true });
      }

      const me = interaction.guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])) {
        return interaction.reply({
          content: 'I need Send Messages and Embed Links permissions in that channel.',
          ephemeral: true,
        });
      }

      await leaveTrackerStore.setConfig(interaction.guildId, channel.id, {
        updatedBy: { id: interaction.user.id, tag: interaction.user.tag },
      });

      // Post a preview so staff can see the embed layout
      try {
        const preview = buildLeaveEmbed(interaction.member, {
          leftAt: new Date(),
          leaveCount: 1,
          reason: { type: 'left' },
        });
        await channel.send({
          content: 'Leave tracker configured. Future departures will appear like this:',
          embeds: [preview],
        });
      } catch (err) {
        console.error('Failed to send leave tracker preview:', err);
      }

      return interaction.reply({
        content: `Leave tracker enabled in ${channel}. I will post a detailed embed each time someone leaves.`,
        ephemeral: true,
      });
    }

    if (sub === 'status') {
      const cfg = leaveTrackerStore.getConfig(interaction.guildId);
      if (!cfg || !cfg.channelId) {
        return interaction.reply({ content: 'Leave tracker is not configured.', ephemeral: true });
      }
      const status = cfg.enabled !== false ? 'Enabled' : 'Disabled';
      const updated = cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : 'Unknown';
      const updatedBy = cfg.updatedBy?.tag || cfg.updatedBy?.id || 'Unknown';
      return interaction.reply({
        content: [
          `Status: **${status}**`,
          `Channel: <#${cfg.channelId}>`,
          `Last updated: ${updated} by ${updatedBy}`,
        ].join('\n'),
        ephemeral: true,
      });
    }

    if (sub === 'disable') {
      const cfg = await leaveTrackerStore.disable(interaction.guildId);
      if (!cfg || !cfg.channelId) {
        return interaction.reply({ content: 'Leave tracker was not configured.', ephemeral: true });
      }
      return interaction.reply({ content: 'Leave tracker disabled. Re-run config to enable it again.', ephemeral: true });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
