import path from 'node:path';
import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  UserSelectMenuBuilder,
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

function buildNominationRow(channelId: string) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(`sacrifice:nominate:${channelId}`)
    .setPlaceholder('Nominate a user for sacrifice')
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu);
}

function sanitizeMediaUrl(value: string | null) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('sacrificeconfig')
    .setDescription('Send the communal sacrifice nomination menu to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the sacrifice nomination menu in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
    .addStringOption((option) =>
      option
        .setName('embed_title')
        .setDescription('Optional title for the initial config embed')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('embed_description')
        .setDescription('Optional description for the initial config embed')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('embed_media')
        .setDescription('Optional image/GIF URL for the initial config embed')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('footer_message')
        .setDescription('Optional footer text for the initial config embed')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to use this command.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel', true) as any;
    const titleInput = interaction.options.getString('embed_title');
    const descriptionInput = interaction.options.getString('embed_description');
    const mediaRaw = interaction.options.getString('embed_media');
    const footerInput = interaction.options.getString('footer_message');

    const mediaUrl = sanitizeMediaUrl(mediaRaw);
    if (mediaRaw && !mediaUrl) {
      return interaction.reply({ content: 'Please provide a valid http(s) media URL for `embed_media`.', ephemeral: true });
    }

    if (!channel?.isTextBased?.()) {
      return interaction.reply({ content: 'Please choose a text-based channel.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ content: `I cannot send messages in ${channel}.`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle((titleInput || 'Communal Sacrifice').slice(0, 256))
      .setDescription((descriptionInput || 'Click the selection menu and type a user to nominate for the communal sacrifice.').slice(0, 4096))
      .setTimestamp();
    if (mediaUrl) embed.setImage(mediaUrl);
    if (footerInput) embed.setFooter({ text: footerInput.slice(0, 2048) });

    try {
      applyDefaultColour(embed, interaction.guildId);
    } catch (_) {}

    try {
      await channel.send({
        embeds: [embed],
        components: [buildNominationRow(channel.id)],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return interaction.reply({ content: `Failed to send the sacrifice menu: ${message}`, ephemeral: true });
    }

    return interaction.reply({
      content: `Sent sacrifice nomination menu to ${channel}.`,
      ephemeral: true,
    });
  },
};

export = command;
