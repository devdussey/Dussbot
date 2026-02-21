import path from 'node:path';
import {
  ChannelType,
  PermissionsBitField,
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

const logger = requireFromSrcIfNeeded('../utils/securityLogger');
const modlog = requireFromSrcIfNeeded('../utils/modLogger');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete a number of recent messages in this channel')
    .addIntegerOption((opt) =>
      opt
        .setName('amount')
        .setDescription('How many messages to delete (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const safeEditOrFollowUp = async (payload: { content: string }) => {
      try {
        await interaction.editReply(payload);
      } catch (err: any) {
        if (err?.code !== 10008) throw err;
        try {
          await interaction.followUp({ ...payload, ephemeral: true });
        } catch (_) {}
      }
    };

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      await logger.logPermissionDenied(interaction, 'purge', 'Bot missing Manage Messages');
      await safeEditOrFollowUp({ content: 'I need the Manage Messages permission.' });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
      await logger.logPermissionDenied(interaction, 'purge', 'User missing Manage Messages');
      await safeEditOrFollowUp({ content: 'You need Manage Messages to use this command.' });
      return;
    }

    const channel = interaction.channel as any;
    const allowedTypes = new Set([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ]);
    if (!channel || !allowedTypes.has(channel.type) || typeof channel.bulkDelete !== 'function') {
      await safeEditOrFollowUp({ content: 'This command can only be used in text channels or threads.' });
      return;
    }

    const amount = interaction.options.getInteger('amount', true);

    try {
      const deleted = await channel.bulkDelete(amount, true);
      const count = deleted?.size ?? 0;
      const note = count < amount ? ' (some messages may be older than 14 days and cannot be deleted)' : '';
      await safeEditOrFollowUp({ content: `Deleted ${count} message(s)${note}.` });
      try {
        await modlog.log(interaction, 'Messages Purged', {
          target: `<#${channel.id}> (${channel.id})`,
          reason: `Requested ${amount} | Deleted ${count}`,
          logKey: 'messages_purged',
          color: 0x2f3136,
          extraFields: [
            { name: 'Requested', value: String(amount), inline: true },
            { name: 'Deleted', value: String(count), inline: true },
          ],
        });
      } catch (_) {}
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await safeEditOrFollowUp({ content: `Failed to purge: ${message}` });
    }
  },
};

export = command;
