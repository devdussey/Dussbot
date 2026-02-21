import path from 'node:path';
import {
  ChannelType,
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

const boosterConfigStore = requireFromSrcIfNeeded('../utils/boosterRoleConfigStore');
const { postBoosterRolePanel } = requireFromSrcIfNeeded('../utils/boosterRolePanel');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('boosterroleconfig')
    .setDescription('Post the booster role configuration panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the booster role setup panel in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
    }

    const channel = (interaction.options.getChannel('channel') || interaction.channel) as any;
    if (!channel?.isTextBased?.()) {
      return interaction.reply({ content: 'Please choose a text-based channel.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ content: `I cannot send messages in ${channel}.`, ephemeral: true });
    }

    try {
      const priorPanel = await boosterConfigStore.getPanel(interaction.guildId);
      if (priorPanel?.channelId && priorPanel?.messageId && priorPanel.channelId !== channel.id) {
        try {
          const oldChannel = await interaction.guild.channels.fetch(priorPanel.channelId);
          if (oldChannel?.isTextBased?.()) {
            const oldMessage = await (oldChannel as any).messages.fetch(priorPanel.messageId);
            if (oldMessage) await oldMessage.delete();
          }
        } catch (_) {}
      }

      const previousMessageId = priorPanel?.channelId === channel.id ? priorPanel?.messageId : null;
      const sent = await postBoosterRolePanel(channel, previousMessageId);
      await boosterConfigStore.setPanel(interaction.guildId, channel.id, sent.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return interaction.reply({ content: `Failed to send the booster role panel: ${message}`, ephemeral: true });
    }

    return interaction.reply({ content: `Sent booster role panel to ${channel}.`, ephemeral: true });
  },
};

export = command;
