const { Events, AuditLogEvent, PermissionsBitField, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');
const userMessageLogStore = require('../utils/userMessageLogStore');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.apng', '.heic', '.gif'];
const RED = 0xed4245;

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
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const att of attachments) {
    if (!att) continue;
    const label = truncate(att.name || 'attachment', 80);
    if (att.url) lines.push(`[${label}](${att.url})`);
    else lines.push(label);
    if (isImageAttachment(att) && att.url) {
      files.push({ attachment: att.url, name: att.name || `attachment-${att.id || files.length + 1}.png` });
    }
    if (lines.length >= 10) break;
  }
  return { lines, files };
}

function buildDeletedEmbed({ message, content, executor, attachmentInfo, contentSource, deletedAt }) {
  const embed = new EmbedBuilder()
    .setTitle('Message Deleted')
    .setColor(RED)
    .setTimestamp(deletedAt)
    .addFields(
      { name: 'User', value: formatUser(message.author || 'Unknown'), inline: false },
      { name: 'Deleted By', value: formatUser(executor || 'Unknown'), inline: false },
      { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: true },
      { name: 'Message ID', value: message.id || 'Unknown', inline: true },
      { name: 'Content', value: content, inline: false },
      { name: 'Attachments', value: attachmentInfo.lines.length ? attachmentInfo.lines.join('\n').slice(0, 1024) : 'None', inline: false },
    )
    .setFooter({ text: `Deleted at ${formatDateTime(deletedAt)}` });

  if (contentSource && contentSource !== 'live') {
    embed.addFields({ name: 'Content Source', value: contentSource, inline: true });
  }

  const thumbTarget = executor || message.author;
  const avatarUrl = thumbTarget?.displayAvatarURL?.({ extension: 'png', size: 256 });
  if (avatarUrl) embed.setThumbnail(avatarUrl);

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
      let executor = null;
      if (me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        try {
          const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
          const entry = logs.entries.find(e => e.target?.id === message.author?.id && (Date.now() - e.createdTimestamp) < 10_000);
          if (entry) executor = entry.executor || null;
        } catch (_) {}
      }
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

      const attachmentInfo = collectAttachmentInfo(message);
      const embed = buildDeletedEmbed({
        message,
        content,
        executor,
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
