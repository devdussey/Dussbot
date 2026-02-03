const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const mediaOnlyStore = require('../utils/mediaOnlyStore');

function resolveChannel(interaction) {
  return interaction.options.getChannel('channel') || interaction.channel;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mediaonly')
    .setDescription('Restrict a channel to media-only posts (admin only)')
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable media-only mode for a channel')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to restrict (defaults to current)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable media-only mode for a channel')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to unrestrict (defaults to current)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check if a channel is media-only')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to check (defaults to current)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Only server administrators can use /mediaonly.', ephemeral: true });
    }

    const channel = resolveChannel(interaction);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ content: 'Pick a text channel to manage.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const enabled = mediaOnlyStore.isChannelMediaOnly(interaction.guildId, channel.id);
      return interaction.reply({
        content: enabled
          ? `${channel} is currently media-only.`
          : `${channel} is not in media-only mode.`,
        ephemeral: true,
      });
    }

    const enable = sub === 'enable';
    mediaOnlyStore.setChannel(interaction.guildId, channel.id, enable);
    return interaction.reply({
      content: enable
        ? `${channel} will now delete non-media messages.`
        : `${channel} will no longer delete non-media messages.`,
      ephemeral: true,
    });
  },
};
