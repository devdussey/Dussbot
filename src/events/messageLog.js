const { Events, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');
const { buildLogEmbed } = require('../utils/logEmbedFactory');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.apng', '.heic'];
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus'];
const GIF_EXTS = ['.gif', '.gifv'];
const BRIGHT_GREEN = 0x00ff73;

function lowercase(str) {
  return typeof str === 'string' ? str.toLowerCase() : '';
}

function stripUrlParams(value) {
  const lower = lowercase(value);
  if (!lower) return '';
  const queryIndex = lower.indexOf('?');
  const hashIndex = lower.indexOf('#');
  let endIndex = lower.length;
  if (queryIndex >= 0) endIndex = Math.min(endIndex, queryIndex);
  if (hashIndex >= 0) endIndex = Math.min(endIndex, hashIndex);
  return lower.slice(0, endIndex);
}

function detectTypeFromContentType(contentType) {
  const ct = lowercase(contentType);
  if (!ct) return null;
  if (ct === 'image/gif') return 'gif';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  return null;
}

function detectTypeFromExtension(nameOrUrl) {
  const value = stripUrlParams(nameOrUrl);
  if (!value) return null;
  if (GIF_EXTS.some(ext => value.endsWith(ext))) return 'gif';
  if (IMAGE_EXTS.some(ext => value.endsWith(ext))) return 'image';
  if (VIDEO_EXTS.some(ext => value.endsWith(ext))) return 'video';
  if (AUDIO_EXTS.some(ext => value.endsWith(ext))) return 'audio';
  return null;
}

function classifyAttachment(attachment) {
  const type = detectTypeFromContentType(attachment.contentType)
    || detectTypeFromExtension(attachment.name || attachment.url);
  if (!type) return null;
  return {
    type,
    name: attachment.name || 'Attachment',
    url: attachment.url,
  };
}

function classifyEmbed(embed) {
  if (!embed) return null;
  const embedType = lowercase(embed.type);
  const resolvedUrl = embed.video?.url || embed.image?.url || embed.thumbnail?.url || embed.url;
  let type = null;
  if (embedType === 'gifv') type = 'gif';
  else if (embedType === 'image') type = 'image';
  else if (embedType === 'video') type = 'video';
  if (!type) type = embed.video ? 'video' : null;
  if (!type) type = embed.image ? 'image' : null;
  if (!type) type = detectTypeFromExtension(resolvedUrl);
  if (!type || !resolvedUrl) return null;
  const name = embed.title || embed.author?.name || resolvedUrl.split('/').pop() || resolvedUrl;
  return { type, name, url: resolvedUrl };
}

function collectMediaFromMessage(message) {
  const attachmentMedia = Array.from(message.attachments?.values?.() || [])
    .map(classifyAttachment)
    .filter(Boolean);
  const embedMedia = (message.embeds || [])
    .map(classifyEmbed)
    .filter(Boolean);
  const stickerItems = Array.from(message.stickers?.values?.() || []).map(sticker => ({
    type: 'sticker',
    name: sticker.name || 'Sticker',
    id: sticker.id,
  }));
  return {
    mediaItems: [...attachmentMedia, ...embedMedia],
    stickerItems,
  };
}

function truncate(str, max) {
  if (!str) return '';
  const input = String(str);
  return input.length > max ? `${input.slice(0, max - 3)}...` : input;
}

function formatMediaSummary(mediaItems, stickerItems) {
  const counts = new Map();
  for (const item of mediaItems) {
    counts.set(item.type, (counts.get(item.type) || 0) + 1);
  }
  if (stickerItems.length) {
    counts.set('sticker', (counts.get('sticker') || 0) + stickerItems.length);
  }
  const parts = Array.from(counts.entries()).map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function formatMediaDetails(mediaItems, stickerItems) {
  const lines = [];
  for (const item of mediaItems.slice(0, 10)) {
    const label = item.type ? `${item.type.charAt(0).toUpperCase()}${item.type.slice(1)}` : 'Media';
    const name = truncate(item.name || 'View', 80);
    const link = item.url ? `[${name}](${item.url})` : name;
    lines.push(`- ${label}: ${link}`);
  }
  if (mediaItems.length > 10) {
    lines.push(`- +${mediaItems.length - 10} more media item(s)`);
  }
  for (const sticker of stickerItems.slice(0, 5)) {
    const name = truncate(sticker.name || 'Sticker', 80);
    lines.push(`- Sticker: ${name} (${sticker.id || 'unknown'})`);
  }
  if (stickerItems.length > 5) {
    lines.push(`- +${stickerItems.length - 5} more sticker(s)`);
  }
  return lines.join('\n').slice(0, 1024) || 'Media details unavailable.';
}

function formatUser(user) {
  if (!user) return 'Unknown user';
  const tag = user.tag || user.username || user.globalName || 'Unknown';
  return `${tag} (${user.id || 'unknown'})`;
}

function formatDateTime(date) {
  const safeDate = date instanceof Date ? date : new Date(date || Date.now());
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(safeDate);
  } catch (_) {
    return safeDate.toISOString();
  }
}

function buildAttachmentInfo(message) {
  const lines = [];
  const files = [];
  const attachments = Array.from(message.attachments?.values?.() || []);

  for (const att of attachments) {
    if (!att) continue;
    const classified = classifyAttachment(att);
    const name = truncate(att.name || classified?.name || 'attachment', 80);
    if (att.url) {
      lines.push(`[${name}](${att.url})`);
    } else {
      lines.push(name);
    }
    if (classified && (classified.type === 'image' || classified.type === 'gif') && att.url) {
      files.push({ attachment: att.url, name: att.name || `attachment-${att.id || files.length + 1}.png` });
    }
    if (lines.length >= 10) break;
  }

  return { lines, files };
}

function buildCreatedEmbed(message, attachmentInfo) {
  const createdAt = message.createdAt || new Date(message.createdTimestamp || Date.now());
  const content = truncate(message.content || '*No content*', 1024) || '*No content*';
  const embed = new EmbedBuilder()
    .setTitle('Message Created')
    .setColor(BRIGHT_GREEN)
    .setTimestamp(createdAt)
    .addFields(
      { name: 'User', value: formatUser(message.author), inline: false },
      { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: true },
      { name: 'Message ID', value: message.id, inline: true },
      { name: 'Content', value: content, inline: false },
      { name: 'Attachments', value: attachmentInfo.lines.length ? attachmentInfo.lines.join('\n').slice(0, 1024) : 'None', inline: false },
    )
    .setFooter({ text: `Created at ${formatDateTime(createdAt)}` });

  const avatarUrl = message.author?.displayAvatarURL?.({ extension: 'png', size: 256 });
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return embed;
}

function buildMediaEmbed(message, mediaItems, stickerItems) {
  const summary = formatMediaSummary(mediaItems, stickerItems);
  const caption = truncate((message.content || '').trim(), 800);
  const reasonParts = [];
  if (summary) reasonParts.push(`Posted ${summary}`);
  if (caption) reasonParts.push(`Caption: ${caption}`);
  const messageLink = message.url ? `[Jump to message](${message.url})` : 'Unavailable';

  return buildLogEmbed({
    action: 'Media Posted',
    target: message.author,
    actor: message.author,
    reason: reasonParts.join('\n') || 'Media posted',
    color: 0x5865f2,
    extraFields: [
      { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: true },
      { name: 'Message ID', value: message.id, inline: true },
      { name: 'Message Link', value: messageLink, inline: false },
      { name: 'Media', value: formatMediaDetails(mediaItems, stickerItems), inline: false },
    ],
  });
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message.guild) return;

      if (message.author?.bot) {
        const attachmentInfo = buildAttachmentInfo(message);
        const content = truncate(message.content || '*No content*', 1024) || '*No content*';
        const embed = buildBotLogEmbed({
          action: 'Message Created',
          botUser: message.author,
          channel: message.channel,
          color: BOT_ACTION_COLORS.messageCreate,
          description: content,
          extraFields: [
            { name: 'Message ID', value: message.id || 'Unknown', inline: true },
            { name: 'Attachments', value: attachmentInfo.lines.length ? attachmentInfo.lines.join('\n').slice(0, 1024) : 'None', inline: false },
          ],
        });

        await logSender.sendLog({
          guildId: message.guild.id,
          logType: BOT_LOG_KEYS.messageCreate,
          embed,
          client: message.client,
          files: attachmentInfo.files,
        });
        return;
      }

      const { mediaItems, stickerItems } = collectMediaFromMessage(message);
      const attachmentInfo = buildAttachmentInfo(message);
      const embed = buildCreatedEmbed(message, attachmentInfo);

      await logSender.sendLog({
        guildId: message.guild.id,
        logType: 'message_create',
        embed,
        client: message.client,
        files: attachmentInfo.files,
      });

      if (mediaItems.length || stickerItems.length) {
        const mediaEmbed = buildMediaEmbed(message, mediaItems, stickerItems);
        await logSender.sendLog({
          guildId: message.guild.id,
          logType: 'media_posted',
          embed: mediaEmbed,
          client: message.client,
        });
      }
    } catch (err) {
      console.error('messageLog.MessageCreate error:', err);
    }
  },
};
