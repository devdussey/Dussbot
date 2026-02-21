import path from 'node:path';
import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageMentionOptions,
} from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

const defaultAllowedMentions: MessageMentionOptions = { parse: [] };

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

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message as the bot')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('Text to send')
        .setRequired(true))
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to send to (defaults to here)')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        )
        .setRequired(false))
    .addBooleanOption((opt) =>
      opt
        .setName('allow_mentions')
        .setDescription('Allow @everyone/@here/roles/users mentions (default: off)')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'Only server administrators can use /say.' });
    }

    const text = interaction.options.getString('message', true);
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const allowMentions = interaction.options.getBoolean('allow_mentions') || false;
    const allowedMentions = allowMentions ? undefined : defaultAllowedMentions;

    if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
      return interaction.editReply({ content: 'Selected channel cannot receive messages.' });
    }

    try {
      if (text.length <= 2000) {
        await channel.send({ content: text, allowedMentions });
      } else {
        for (let i = 0; i < text.length; i += 2000) {
          const chunk = text.slice(i, i + 2000);
          await channel.send({ content: chunk, allowedMentions });
        }
      }
      return interaction.editReply({ content: `Message sent to ${channel}.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return interaction.editReply({ content: `Failed to send message: ${message}` });
    }
  },
};

export = command;
