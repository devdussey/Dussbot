const { Events, AuditLogEvent, PermissionsBitField, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');
const userMessageLogStore = require('../utils/userMessageLogStore');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.apng', '.heic', '.gif'];
const RED = 0xed4245;
const MESSAGE_DELETE_AUDIT_MAX_AGE_MS = 20_000;
const MESSAGE_DELETE_AUDIT_RETRY_DELAY_MS = 1200;

function truncate(str, max = 1024) {
  if (!str) return '';
  const value = String(str);
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function getCachedContent(message) {
  const guildId = message?.guildId || message?.guild?.id;
  if (!guildId || !message?.author?.id) return null;
  const recent = userMessageLogStore.getRecentMessages(guildId, message.author.id, 50);
  if (!recent.length) return null;
  const exact = recent.find(entry => entry.id === message.id && entry.content);
  if (exact) return { content: exact.content, source: 'cached_exact' };
  const sameChannel = recent.filter(entry => entry.channelId === message.channelId && entry.content);
  if (sameChannel.length) {
    const nearest = sameChannel[sameChannel.length - 1];
    return { content: nearest.content, source: 'cached_channel' };
  }
  return null;
}

function formatUser(user) {
  if (!user) return 'Unknown user';
  const tag = user.tag || user.username || user.globalName || 'Unknown';
  return `${tag} (${user.id || 'unknown'})`;
}

function formatDateTime(date) {
  const safeDate = date instanceof Date ? date : new Date(date || Date.now());
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(safeDate);
  } catch (_) {
    return safeDate.toISOString();
  }
}

function isImageAttachment(att) {
  if (!att) return false;
  const contentType = (att.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const name = (att.name || att.url || '').toLowerCase();
  return IMAGE_EXTS.some(ext => name.endsWith(ext));
}

function collectAttachmentInfo(message) {
  const lines = [];
  const files = [];
  let previewImageUrl = null;
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const att of attachments) {
    if (!att) continue;
    const label = truncate(att.name || 'attachment', 80);
    if (att.url) lines.push(`[${label}](${att.url})`);
    else lines.push(label);
    if (isImageAttachment(att) && att.url) {
      if (!previewImageUrl) previewImageUrl = att.url;
      files.push({ attachment: att.url, name: att.name || `attachment-${att.id || files.length + 1}.png` });
    }
    if (lines.length >= 10) break;
  }
  return { lines, files, previewImageUrl };
}

function delay(ms) {
  const timeoutMs = Number(ms) || 0;
  return new Promise(resolve => setTimeout(resolve, Math.max(0, timeoutMs)));
}

function matchesMessageDeleteAuditEntry(entry, message, nowMs) {
  if (!entry?.createdTimestamp) return false;
  if ((nowMs - entry.createdTimestamp) > MESSAGE_DELETE_AUDIT_MAX_AGE_MS) return false;

  const authorId = message?.author?.id ? String(message.author.id) : null;
  const targetId = entry?.target?.id ? String(entry.target.id) : null;
  if (authorId && targetId && authorId !== targetId) return false;

  const auditChannelId = entry?.extra?.channel?.id || entry?.extra?.channelId || null;
  const messageChannelId = message?.channel?.id || message?.channelId || null;
  if (auditChannelId && messageChannelId && String(auditChannelId) !== String(messageChannelId)) return false;

  const count = Number(entry?.extra?.count ?? entry?.extra?.messageCount ?? 1);
  if (Number.isFinite(count) && count < 1) return false;

  return true;
}

async function fetchDeleteExecutor(guild, message) {
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 });
  const nowMs = Date.now();
  const candidates = [...logs.entries.values()].filter(entry => matchesMessageDeleteAuditEntry(entry, message, nowMs));
  if (!candidates.length) return null;

  const newest = candidates.reduce((best, entry) => {
    if (!best) return entry;
    const bestTs = Number(best.createdTimestamp) || 0;
    const entryTs = Number(entry.createdTimestamp) || 0;
    return entryTs >= bestTs ? entry : best;
  }, null);

  return newest?.executor || null;
}

async function resolveDeleteExecutor(guild, message) {
  try {
    const first = await fetchDeleteExecutor(guild, message);
    if (first) return first;
    await delay(MESSAGE_DELETE_AUDIT_RETRY_DELAY_MS);
    return await fetchDeleteExecutor(guild, message);
  } catch (_) {
    return null;
  }
}

function buildDeletedEmbed({ message, content, deleterText, attachmentInfo, contentSource, deletedAt }) {
  const avatarUrl = message.author?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;
  const mention = message.author?.id ? `<@${message.author.id}> (${message.author.id})` : formatUser(message.author || 'Unknown');
  const embed = new EmbedBuilder()
    .setTitle('Message Deleted')
    .setColor(RED)
    .setTimestamp(deletedAt)
    .addFields(
      { name: 'Content', value: `${content}\n- ${mention}`, inline: false },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: false },
    )
    .setFooter({ text: `Deleted at ${formatDateTime(deletedAt)}`, iconURL: avatarUrl || undefined });

  if (deleterText && deleterText !== 'Unknown') {
    embed.addFields({ name: 'Deleted By', value: deleterText, inline: false });
  }
  if (attachmentInfo.lines.length) {
    embed.addFields({ name: 'Image', value: attachmentInfo.lines.join('\n').slice(0, 1024), inline: false });
  }
  if (contentSource && contentSource !== 'live') {
    embed.addFields({ name: 'Content Source', value: contentSource, inline: false });
  }

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  if (attachmentInfo.previewImageUrl) {
    embed.setImage(attachmentInfo.previewImageUrl);
  }

  return embed;
}

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      if (!message?.guild || !message.channel) return;
      const guild = message.guild;
      const clientUserId = message.client?.user?.id;

      if (message.author?.bot) {
        if (message.author.id === clientUserId) return;
        const cached = getCachedContent(message);
        let content = message.content ? truncate(message.content) : '';
        if (!content && cached?.content) {
          content = truncate(cached.content);
        }
        if (!content) content = '*No content available*';

        const attachmentInfo = collectAttachmentInfo(message);
        const embed = buildBotLogEmbed({
          action: 'Message Deleted',
          botUser: message.author,
          channel: message.channel,
          color: BOT_ACTION_COLORS.messageDelete,
          extraFields: [
            { name: 'Message ID', value: message.id || 'Unknown', inline: true },
            { name: 'Content', value: content, inline: false },
            { name: 'Attachments', value: attachmentInfo.lines.length ? attachmentInfo.lines.join('\n').slice(0, 1024) : 'None', inline: false },
          ],
        });

        await logSender.sendLog({
          guildId: guild.id,
          logType: BOT_LOG_KEYS.messageDelete,
          embed,
          client: message.client,
          files: attachmentInfo.files,
        });
        return;
      }

      const me = guild.members.me;
      if (!me) return;
      const canViewAuditLog = me.permissions.has(PermissionsBitField.Flags.ViewAuditLog);
      const executor = canViewAuditLog ? await resolveDeleteExecutor(guild, message) : null;
      let content = message.content ? truncate(message.content) : '';
      let contentSource = 'live';
      if (!content) {
        const cached = getCachedContent(message);
        if (cached?.content) {
          content = truncate(cached.content);
          contentSource = cached.source === 'cached_exact'
            ? 'cache: exact message'
            : 'cache: recent channel message';
        }
      }
      if (!content) content = '*No content available*';

      let deleterText = 'Unknown';
      if (executor) {
        deleterText = formatUser(executor);
      } else if (message.author) {
        deleterText = `${formatUser(message.author)} (${canViewAuditLog ? 'self-delete likely' : 'no audit access'})`;
      }

      const attachmentInfo = collectAttachmentInfo(message);
      const embed = buildDeletedEmbed({
        message,
        content,
        deleterText,
        attachmentInfo,
        contentSource,
        deletedAt: new Date(),
      });
      await logSender.sendLog({
        guildId: guild.id,
        logType: 'message_delete',
        embed,
        client: message.client,
        ownerFallback: true,
        files: attachmentInfo.files,
      });
    } catch (err) {
      console.error('messageDelete handler error:', err);
    }
  },
};
