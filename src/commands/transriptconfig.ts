import path from 'node:path';
import { ChannelType, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const store = requireFromSrcIfNeeded('../utils/voiceAutoStore');

function isTextLike(channel: any) {
  if (!channel) return false;
  return [
    ChannelType.GuildText,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.GuildAnnouncement,
  ].includes(channel.type);
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('transriptconfig')
    .setDescription('Configure automatic voice-message transcription')
    .addSubcommand((sub) =>
      sub.setName('enable')
        .setDescription('Enable automatic transcription in a channel')
        .addChannelOption((opt) =>
          opt.setName('channel')
            .setDescription('Channel to enable (defaults to the current channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.GuildAnnouncement,
            )
            .setRequired(false)))
    .addSubcommand((sub) =>
      sub.setName('disable')
        .setDescription('Disable automatic transcription in a channel or everywhere')
        .addChannelOption((opt) =>
          opt.setName('channel')
            .setDescription('Channel to disable (defaults to the current channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.GuildAnnouncement,
            )
            .setRequired(false))
        .addBooleanOption((opt) =>
          opt.setName('all')
            .setDescription('Disable automatic transcription for all channels')
            .setRequired(false)))
    .addSubcommand((sub) =>
      sub.setName('status')
        .setDescription('Show channels with automatic voice transcription enabled')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server channel.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.editReply({ content: 'You need the Manage Server permission to configure this.' });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId as string;

    if (sub === 'enable') {
      const providedChannel = interaction.options.getChannel('channel');
      const target = providedChannel || interaction.channel;
      if (!isTextLike(target)) {
        return interaction.editReply({ content: 'Please choose a text channel or thread.' });
      }
      const added = await store.enableChannel(guildId, target.id);
      if (!added) {
        return interaction.editReply({ content: `Automatic transcription is already enabled in ${target}.` });
      }
      return interaction.editReply({ content: `Automatic transcription enabled in ${target}.` });
    }

    if (sub === 'disable') {
      const disableAll = interaction.options.getBoolean('all') || false;
      if (disableAll) {
        const hadAny = await store.clearGuild(guildId);
        if (hadAny) {
          return interaction.editReply({ content: 'Automatic voice transcription disabled for all channels.' });
        }
        return interaction.editReply({ content: 'Automatic voice transcription was already disabled everywhere.' });
      }
      const providedChannel = interaction.options.getChannel('channel');
      const target = providedChannel || interaction.channel;
      if (!isTextLike(target)) {
        return interaction.editReply({ content: 'Please choose a text channel or thread.' });
      }
      const removed = await store.disableChannel(guildId, target.id);
      if (!removed) {
        return interaction.editReply({ content: `Automatic transcription was not enabled in ${target}.` });
      }
      return interaction.editReply({ content: `Automatic transcription disabled in ${target}.` });
    }

    if (sub === 'status') {
      const channels = await store.listChannels(guildId);
      if (!channels.length) {
        return interaction.editReply({ content: 'Automatic voice transcription is not enabled in any channels.' });
      }
      const names = channels.map((id: string) => `<#${id}> (${id})`).join('\n');
      return interaction.editReply({ content: `Automatic transcription is enabled in:\n${names}` });
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },
};

export = command;
