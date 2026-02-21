import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const { applyDefaultColour } = requireFromSrcIfNeeded('../utils/guildColourStore');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('suggestconfig')
    .setDescription('Send the anonymous suggestion prompt to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the suggestion button in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel', true) as any;
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
      applyDefaultColour(embed, interaction.guildId);
    } catch (_) {}

    const button = new ButtonBuilder()
      .setCustomId(`suggest:open:${channel.id}`)
      .setLabel('Share an Anonymous Suggestion')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    try {
      await channel.send({ embeds: [embed], components: [row] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return interaction.reply({ content: `Failed to send the suggestion prompt: ${message}`, ephemeral: true });
    }

    return interaction.reply({ content: `Sent suggestion prompt to ${channel}.`, ephemeral: true });
  },
};

export = command;
