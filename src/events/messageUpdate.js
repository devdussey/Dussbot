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

function buildEditedEmbed(oldMessage, newMessage) {
  const editedAt = newMessage.editedAt || new Date();
  const postedAt = newMessage.createdAt || oldMessage?.createdAt || new Date(newMessage.createdTimestamp || Date.now());
  const originalContent = truncate(oldMessage?.content);
  const editedContent = truncate(newMessage?.content);

  const embed = new EmbedBuilder()
    .setTitle('Message Edited')
    .setColor(YELLOW)
    .setTimestamp(editedAt)
    .addFields(
      { name: 'Message Author', value: formatUser(newMessage.author), inline: false },
      { name: 'Edited By', value: formatUser(newMessage.author), inline: false },
      { name: 'Channel', value: `<#${newMessage.channel.id}> (${newMessage.channel.id})`, inline: true },
      { name: 'Message ID', value: newMessage.id, inline: true },
      { name: 'Posted At', value: formatDateTime(postedAt), inline: true },
      { name: 'Original Content', value: originalContent, inline: false },
      { name: 'Edited Content', value: editedContent, inline: false },
    )
    .setFooter({ text: `Edited at ${formatDateTime(editedAt)}` });

  const avatarUrl = newMessage.author?.displayAvatarURL?.({ extension: 'png', size: 256 });
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return embed;
}

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.guild) return;

      if (newMessage.author?.bot) {
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
