const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestconfig')
    .setDescription('Send the anonymous suggestion prompt to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the suggestion button in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
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
      .setTitle('Anonymous Suggestions')
      .setDescription('Share a suggestion anonymously by pressing the button below.')
      .setTimestamp();

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, interaction.guildId);
    } catch (_) {}

    const button = new ButtonBuilder()
      .setCustomId(`suggest:open:${channel.id}`)
      .setLabel('Share an Anonymous Suggestion')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    try {
      await channel.send({ embeds: [embed], components: [row] });
    } catch (error) {
      return interaction.reply({ content: `Failed to send the suggestion prompt: ${error.message}`, ephemeral: true });
    }

    return interaction.reply({ content: `Sent suggestion prompt to ${channel}.`, ephemeral: true });
  },
};
