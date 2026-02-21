import path from 'node:path';
import { AuditLogEvent, EmbedBuilder, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const cmdLogger = requireFromSrcIfNeeded('../utils/logger')('botlist');
const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');

const maxFieldsPerEmbed = 25;
const maxEmbeds = 10;
const auditFetchLimit = 100;

function formatPermissions(permissions: string[]) {
  if (!permissions.length) return 'None';
  const display = permissions.slice(0, 6);
  const extra = permissions.length - display.length;
  return `${display.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function loadBotAddAuditEntries(guild: any, botIds: string[]) {
  const botAddMap = new Map();
  const pendingIds = new Set(botIds);
  let before: string | undefined;

  while (pendingIds.size) {
    const options: any = { type: AuditLogEvent.BotAdd, limit: auditFetchLimit };
    if (before) options.before = before;
    const auditLogs = await guild.fetchAuditLogs(options);
    const entries = [...auditLogs.entries.values()];
    if (!entries.length) break;

    for (const entry of entries) {
      if (!botAddMap.has(entry.targetId)) {
        botAddMap.set(entry.targetId, entry);
        pendingIds.delete(entry.targetId);
      }
    }

    if (entries.length < auditFetchLimit) break;
    before = entries[entries.length - 1]?.id;
    if (!before) break;
  }

  return botAddMap;
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('botlist')
    .setDescription('Show a breakdown of all bots in the server')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need Administrator permissions to use this command.', ephemeral: true });
    }

    await interaction.deferReply();
    const guild = interaction.guild;

    let refreshed = true;
    try {
      await guild.members.fetch();
    } catch (err) {
      refreshed = false;
      cmdLogger.warn('Bot list: failed to refresh member cache', err);
    }

    const botMembers = [...guild.members.cache.values()]
      .filter((member: any) => member.user?.bot)
      .sort((a: any, b: any) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0));

    if (!botMembers.length) {
      const embed = new EmbedBuilder()
        .setTitle('Bot List')
        .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
        .setDescription('No bots are currently in this server.')
        .setFooter({ text: `Requested by ${interaction.user.tag}` });
      return interaction.editReply({ embeds: [embed] });
    }

    let auditLogError = false;
    let botAddMap = new Map();
    if (botMembers.length) {
      try {
        const botIds = botMembers.map((member: any) => member.id);
        botAddMap = await loadBotAddAuditEntries(guild, botIds);
      } catch (err) {
        auditLogError = true;
        cmdLogger.warn('Bot list: failed to fetch audit logs', err);
      }
    }

    const fields = botMembers.map((member: any, index: number) => {
      const perms = member.permissions?.toArray?.() ?? [];
      const permissionText = formatPermissions(perms);
      const joinedText = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown';
      const logEntry: any = botAddMap.get(member.id);
      const addedBy = logEntry?.executor ? `${logEntry.executor.tag} (${logEntry.executor.id})` : 'Unknown';
      return {
        name: `${index + 1}. ${member.user.tag}`,
        value: [`ID: ${member.user.id}`, `Permissions: ${permissionText}`, `Joined: ${joinedText}`, `Added by: ${addedBy}`].join('\n'),
      };
    });

    const fieldChunks = chunkArray(fields, maxFieldsPerEmbed);
    const truncated = fieldChunks.length > maxEmbeds;
    const limitedChunks = truncated ? fieldChunks.slice(0, maxEmbeds) : fieldChunks;
    const embeds = limitedChunks.map((chunk, chunkIndex) => {
      const start = chunkIndex * maxFieldsPerEmbed + 1;
      const end = Math.min(start + chunk.length - 1, botMembers.length);
      return new EmbedBuilder()
        .setTitle(`Bot List (${start}-${end} of ${botMembers.length})`)
        .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
        .addFields(chunk as any)
        .setFooter({ text: `Requested by ${interaction.user.tag}` });
    });

    const notes: string[] = [];
    if (!refreshed) notes.push('Member cache refresh failed; list may be incomplete.');
    if (auditLogError) notes.push('Could not read audit logs; "Added by" may be unavailable.');
    if (truncated) notes.push(`Output truncated to the first ${maxFieldsPerEmbed * maxEmbeds} bots.`);
    if (notes.length) embeds[0].setDescription(notes.join(' | '));

    return interaction.editReply({ embeds });
  },
};

export = command;
