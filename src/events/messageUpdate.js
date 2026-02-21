const { Events, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

const YELLOW = 0xffd166;

function truncate(str, max = 1024) {
  if (!str) return '*No content*';
  const value = String(str);
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
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

function buildAttachmentInfo(message) {
  const attachments = Array.from(message?.attachments?.values?.() || []);
  const lines = [];
  let previewImageUrl = null;
  for (const att of attachments) {
    if (!att) continue;
    const label = truncate(att.name || 'attachment', 80);
    lines.push(att.url ? `[${label}](${att.url})` : label);
    const contentType = (att.contentType || '').toLowerCase();
    if (!previewImageUrl && att.url && contentType.startsWith('image/')) {
      previewImageUrl = att.url;
    }
    if (lines.length >= 10) break;
  }
  return { lines, previewImageUrl };
}

function buildEditedEmbed(oldMessage, newMessage) {
  const editedAt = newMessage.editedAt || new Date();
  const avatarUrl = newMessage.author?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;
  const originalContent = truncate(oldMessage?.content);
  const editedContent = truncate(newMessage?.content);
  const authorMention = newMessage.author?.id
    ? `<@${newMessage.author.id}> (${newMessage.author.id})`
    : formatUser(newMessage.author);
  const attachmentInfo = buildAttachmentInfo(newMessage);

  const embed = new EmbedBuilder()
    .setTitle('Message Edited')
    .setColor(YELLOW)
    .setTimestamp(editedAt)
    .addFields(
      { name: 'Content', value: `${originalContent}\n- ${authorMention}`, inline: false },
      { name: 'Edited Message', value: editedContent, inline: false },
      { name: 'Channel', value: `<#${newMessage.channel.id}>`, inline: false },
    )
    .setFooter({ text: `Edited at ${formatDateTime(editedAt)}`, iconURL: avatarUrl || undefined });

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  if (attachmentInfo.lines.length) {
    embed.addFields({ name: 'Image', value: attachmentInfo.lines.join('\n').slice(0, 1024), inline: false });
  }
  if (attachmentInfo.previewImageUrl) {
    embed.setImage(attachmentInfo.previewImageUrl);
  }

  return embed;
}

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.guild) return;
      const clientUserId = newMessage.client?.user?.id;

      if (newMessage.author?.bot) {
        if (newMessage.author.id === clientUserId) return;
        if (oldMessage?.content === newMessage?.content) return;
        const embed = buildBotLogEmbed({
          action: 'Message Edited',
          botUser: newMessage.author,
          channel: newMessage.channel,
          color: BOT_ACTION_COLORS.messageEdit,
          extraFields: [
            { name: 'Message ID', value: newMessage.id || 'Unknown', inline: true },
            { name: 'Original Content', value: truncate(oldMessage?.content), inline: false },
            { name: 'Edited Content', value: truncate(newMessage?.content), inline: false },
          ],
        });
        await logSender.sendLog({
          guildId: newMessage.guild.id,
          logType: BOT_LOG_KEYS.messageEdit,
          embed,
          client: newMessage.client,
        });
        return;
      }

      if (oldMessage?.content === newMessage?.content) return;
      const embed = buildEditedEmbed(oldMessage, newMessage);
      await logSender.sendLog({
        guildId: newMessage.guild.id,
        logType: 'message_edit',
        embed,
        client: newMessage.client,
      });
    } catch (err) {
      console.error('messageUpdate error:', err);
    }
  },
};
