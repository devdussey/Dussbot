const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');

function buildNominationRow(channelId) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(`sacrifice:nominate:${channelId}`)
    .setPlaceholder('Nominate a user for sacrifice')
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sacrificeconfig')
    .setDescription('Send the communal sacrifice nomination menu to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the sacrifice nomination menu in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to use this command.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel', true);
    if (!channel?.isTextBased?.()) {
      return interaction.reply({ content: 'Please choose a text-based channel.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ content: `I cannot send messages in ${channel}.`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Communal Sacrifice')
      .setDescription('Click the selection menu and type a user to nominate for the communal sacrifice.')
      .setTimestamp();

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, interaction.guildId);
    } catch (_) {}

    try {
      await channel.send({
        embeds: [embed],
        components: [buildNominationRow(channel.id)],
      });
    } catch (error) {
      return interaction.reply({ content: `Failed to send the sacrifice menu: ${error.message}`, ephemeral: true });
    }

    return interaction.reply({ content: `Sent sacrifice nomination menu to ${channel}.`, ephemeral: true });
  },
};
