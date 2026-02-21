import path from 'node:path';
import { ChannelType, EmbedBuilder, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const store = requireFromSrcIfNeeded('../utils/stickyMessageStore');

const delayChoices = [
  { name: '1 second', value: 1000 },
  { name: '5 seconds', value: 5000 },
  { name: '10 seconds', value: 10000 },
  { name: '30 seconds', value: 30000 },
  { name: '60 seconds', value: 60000 },
];

async function buildSnapshotFromSource(sourceMessageId: string, sourceChannel: any) {
  try {
    const fetched = await sourceChannel.messages.fetch(sourceMessageId);
    const content = fetched.content?.trim() || '';
    const hasEmbeds = Array.isArray(fetched.embeds) && fetched.embeds.length > 0;
    const hasComponents = Array.isArray(fetched.components) && fetched.components.length > 0;
    const hasAttachments = fetched.attachments?.size > 0;
    if (!content && !hasEmbeds && !hasComponents && !hasAttachments) {
      return { error: 'That source message is empty and cannot be stickied.' };
    }
    const preview = content || fetched.embeds?.[0]?.data?.description?.trim() || fetched.embeds?.[0]?.data?.title?.trim() || '(source message)';
    return { mode: 'source', content: preview, sourceMessageId: fetched.id, sourceChannelId: fetched.channelId };
  } catch (_) {
    return { error: 'I could not fetch that source message. Make sure the ID and channel are correct.' };
  }
}

async function fetchBotMember(guild: any) {
  if (!guild) return null;
  if (guild.members.me) return guild.members.me;
  try {
    return await guild.members.fetchMe();
  } catch (_) {
    return null;
  }
}

function collectMissingStickyPerms(channel: any, member: any, mode: string) {
  const perms = channel?.permissionsFor(member);
  const missing: string[] = [];
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) missing.push('ViewChannel');
  if (!perms?.has(PermissionsBitField.Flags.SendMessages)) missing.push('SendMessages');
  if ((mode === 'embed' || mode === 'source') && !perms?.has(PermissionsBitField.Flags.EmbedLinks)) missing.push('EmbedLinks');
  if (mode === 'source' && !perms?.has(PermissionsBitField.Flags.AttachFiles)) missing.push('AttachFiles');
  return missing;
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('stickymessage')
    .setDescription('Create a sticky message that re-posts after chat activity')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set or replace sticky message settings for a channel')
        .addChannelOption((opt) =>
          opt.setName('channel')
            .setDescription('Channel where the sticky message should post')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption((opt) =>
          opt.setName('delay')
            .setDescription('How long to wait after a message before posting the sticky')
            .setRequired(true)
            .addChoices(...delayChoices))
        .addStringOption((opt) =>
          opt.setName('type')
            .setDescription('Send as a normal message or embed')
            .addChoices({ name: 'Normal message', value: 'normal' }, { name: 'Embed', value: 'embed' }))
        .addStringOption((opt) => opt.setName('message').setDescription('Sticky text (required unless using source_message_id)'))
        .addStringOption((opt) => opt.setName('source_message_id').setDescription('Copy content from an existing message ID instead'))
        .addChannelOption((opt) =>
          opt.setName('source_channel')
            .setDescription('Channel containing source_message_id (defaults to target channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Disable sticky messages in a channel')
        .addChannelOption((opt) =>
          opt.setName('channel')
            .setDescription('Channel to clear sticky message from')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('View sticky message settings in this server')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Only admins can use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const delayMs = interaction.options.getInteger('delay', true);
      const type = interaction.options.getString('type') || 'normal';
      const message = interaction.options.getString('message')?.trim() || '';
      const sourceMessageId = interaction.options.getString('source_message_id')?.trim();
      const sourceChannel = (interaction.options.getChannel('source_channel') || channel) as any;

      let mode = type;
      let content = message;
      let sourceMessage: string | null = null;
      let sourceChannelId: string | null = null;

      if (sourceMessageId) {
        const source = await buildSnapshotFromSource(sourceMessageId, sourceChannel);
        if ((source as any).error) return interaction.editReply({ content: (source as any).error });
        mode = (source as any).mode;
        content = (source as any).content;
        sourceMessage = (source as any).sourceMessageId;
        sourceChannelId = (source as any).sourceChannelId;
      }

      if (!content) return interaction.editReply({ content: 'Provide `message` or `source_message_id` when setting a sticky message.' });
      if (mode === 'embed' && content.length > 4096) return interaction.editReply({ content: 'Embed sticky content cannot be longer than 4096 characters.' });
      if (mode === 'normal' && content.length > 2000) return interaction.editReply({ content: 'Normal sticky content cannot be longer than 2000 characters.' });

      const me = await fetchBotMember(interaction.guild);
      if (!me) return interaction.editReply({ content: 'I could not resolve my member profile in this server. Please try again.' });
      const missingPerms = collectMissingStickyPerms(channel, me, mode);
      if (missingPerms.length) {
        return interaction.editReply({ content: `I cannot post sticky messages in ${channel}. Missing permission(s): ${missingPerms.map((p) => `\`${p}\``).join(', ')}.` });
      }

      await store.setChannelConfig(interaction.guildId, channel.id, {
        mode,
        content,
        delayMs,
        stickyMessageId: null,
        sourceMessageId: sourceMessage,
        sourceChannelId,
      });

      return interaction.editReply({ content: `Sticky message configured for ${channel} (${mode === 'source' ? 'source clone' : mode}, ${delayMs / 1000}s delay).` });
    }

    if (sub === 'clear') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const removed = await store.clearChannelConfig(interaction.guildId, channel.id);
      return interaction.editReply({ content: removed ? `Sticky message cleared for ${channel}.` : `No sticky message configured for ${channel}.` });
    }

    if (sub === 'view') {
      const configs = await store.listChannelConfigs(interaction.guildId);
      if (!configs.length) return interaction.editReply({ content: 'No sticky messages configured in this server.' });

      const embed = new EmbedBuilder()
        .setTitle('Sticky Message Settings')
        .setColor(0x5865f2)
        .setDescription('Configured sticky messages by channel.');

      embed.addFields(
        ...configs.slice(0, 25).map((cfg: any) => ({
          name: `<#${cfg.channelId}>`,
          value: [
            `Type: **${cfg.mode}**`,
            `Delay: **${Math.max(1, Math.round(cfg.delayMs / 1000))}s**`,
            cfg.sourceMessageId ? `Source: [message](${`https://discord.com/channels/${interaction.guildId}/${cfg.sourceChannelId || cfg.channelId}/${cfg.sourceMessageId}`})` : `Preview: ${cfg.content.slice(0, 120) || '(empty)'}`,
          ].join('\n'),
          inline: false,
        })),
      );

      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },
};

export = command;
