const { Events, EmbedBuilder } = require('discord.js');
const store = require('../utils/restrainingOrderStore');
const logSender = require('../utils/logSender');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function truncate(value, max) {
  if (!value) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function formatUser(user) {
  if (!user) return 'Unknown user';
  const tag = user.tag || user.username || user.globalName || 'Unknown';
  return `${tag} (${user.id || 'unknown'})`;
}

async function getReplyAuthor(message) {
  const direct = message.mentions?.repliedUser;
  if (direct) return direct;
  const ref = message.reference?.messageId;
  if (!ref) return null;
  try {
    const replied = await message.fetchReference();
    return replied?.author || null;
  } catch (_) {
    return null;
  }
}

function collectMentionTargets(message) {
  const ids = new Set();
  const mentions = message.mentions?.users;
  if (mentions) {
    for (const user of mentions.values()) {
      if (user?.id) ids.add(user.id);
    }
  }
  return ids;
}

function buildLogEmbed({ guildId, author, target, message, violation }) {
  const color = resolveEmbedColour(guildId, 0xed4245);
  const content = truncate(message?.content || '*No content*', 1024) || '*No content*';
  const embed = new EmbedBuilder()
    .setTitle('Restraining Order Violation')
    .setColor(color)
    .setTimestamp(new Date())
    .addFields(
      { name: 'Author', value: formatUser(author), inline: true },
      { name: 'Target', value: formatUser(target), inline: true },
      { name: 'Violation', value: violation, inline: true },
      { name: 'Channel', value: message?.channelId ? `<#${message.channelId}>` : 'Unknown', inline: true },
      { name: 'Message ID', value: message?.id || 'Unknown', inline: true },
      { name: 'Content', value: content, inline: false },
    );
  return embed;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message?.guild) return;
      if (message.author?.bot) return;

      const guildId = message.guild.id;
      const authorId = message.author?.id;
      if (!authorId) return;

      const mentionTargets = collectMentionTargets(message);
      const replyAuthor = await getReplyAuthor(message);
      if (replyAuthor?.id) mentionTargets.add(replyAuthor.id);

      if (!mentionTargets.size) return;

      for (const targetId of mentionTargets) {
        if (targetId === authorId) continue;
        const entry = await store.get(guildId, authorId, targetId);
        if (!entry) continue;

        const violation = replyAuthor?.id === targetId ? 'Reply' : 'Mention';
        try { await message.delete(); } catch (_) {}

        const embed = buildLogEmbed({
          guildId,
          author: message.author,
          target: replyAuthor?.id === targetId ? replyAuthor : message.mentions.users.get(targetId),
          message,
          violation,
        });
        await logSender.sendLog({
          guildId,
          logType: 'restraining_order_violation',
          embed,
          client: message.client,
        });
        break;
      }
    } catch (_) { /* swallow */ }
  },
};
