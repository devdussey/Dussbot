const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const PANEL_DESCRIPTION = [
  'Step 1. Figure out your exact hex codes you would like first. If you are unsure, visit https://www.eggradients.com/tool/discord-color-codes first. Primary is the left side and Secondary is right side of your username. (When picking gradiants) Alternatively, if you would rather not have gradiant, just put your hex code in for primary and leave secondary blank.',
  '',
  'Step 2. Hit the green button below when ready.',
  '',
  'Step 3. Fill in the boxes of the modal. Role Name is quite self explanitory. The Boxes underneath you will need to enter your colours in this format: #ff0000',
  '',
  'Step 4. When you are finished, hit the finish button and the bot does the rest. if this has errors, let a admin know please.',
].join('\n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('brconfig')
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

    const embed = new EmbedBuilder()
      .setColor(0x00f9ff)
      .setDescription(PANEL_DESCRIPTION);

    const button = new ButtonBuilder()
      .setCustomId('brconfig:open')
      .setLabel('Click Here')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    try {
      await channel.send({ embeds: [embed], components: [row] });
    } catch (error) {
      return interaction.reply({ content: `Failed to send the booster role panel: ${error.message}`, ephemeral: true });
    }

    return interaction.reply({ content: `Sent booster role panel to ${channel}.`, ephemeral: true });
  },
};
