const { EmbedBuilder } = require('discord.js');

const BOT_LOG_KEYS = Object.freeze({
  group: 'bot',
  join: 'bot_join',
  leave: 'bot_leave',
  messageCreate: 'bot_message_create',
  messageDelete: 'bot_message_delete',
  messageEdit: 'bot_message_edit',
  moderation: 'bot_moderation',
});

const BOT_LOG_KEY_LIST = Object.freeze([...new Set(Object.values(BOT_LOG_KEYS))]);

const BOT_ACTION_COLORS = Object.freeze({
  join: 0x2ecc71,
  leave: 0xed4245,
  messageCreate: 0x00ff73,
  messageDelete: 0xed4245,
  messageEdit: 0xffd166,
  moderation: 0xeb459e,
  fallback: 0x5865f2,
});

function formatUser(user, fallback = 'Unknown') {
  if (!user) return fallback;
  if (typeof user === 'string') return user;
  const tag = user.tag || user.username || user.globalName || user.name || 'Unknown';
  const id = user.id || 'unknown';
  return `${tag} (${id})`;
}

function formatChannel(channel) {
  if (!channel) return 'Unknown channel';
  if (typeof channel === 'string') return channel;
  const mention = channel.id ? `<#${channel.id}> (${channel.id})` : 'Unknown channel';
  if (typeof channel.isThread === 'function' ? channel.isThread() : Boolean(channel.isThread)) {
    return `Thread — ${mention}`;
  }
  return mention;
}

function buildBotLogEmbed({
  action,
  botUser,
  channel = null,
  inviter = null,
  actor = null,
  description = null,
  color = BOT_ACTION_COLORS.fallback,
  timestamp = new Date(),
  extraFields = [],
}) {
  const embed = new EmbedBuilder()
    .setTitle('Bot Activity')
    .setColor(color || BOT_ACTION_COLORS.fallback)
    .setTimestamp(timestamp)
    .addFields(
      { name: 'Name of Bot', value: formatUser(botUser), inline: false },
      { name: 'Bot Action', value: action || 'Unknown action', inline: true },
      { name: 'Bot Invited By', value: inviter ? formatUser(inviter) : 'Unknown / N/A', inline: true },
    );

  if (channel) {
    embed.addFields({ name: 'Channel', value: formatChannel(channel), inline: true });
  }

  if (actor) {
    embed.addFields({ name: 'Moderator / Actor', value: formatUser(actor), inline: true });
  }

  if (description) {
    embed.addFields({ name: 'Details', value: String(description).slice(0, 1024) || 'N/A', inline: false });
  }

  for (const field of extraFields.filter(Boolean)) {
    embed.addFields(field);
  }

  const thumb = typeof botUser?.displayAvatarURL === 'function'
    ? botUser.displayAvatarURL({ size: 256 })
    : null;
  if (thumb) embed.setThumbnail(thumb);

  embed.setFooter({
    text: `Date & time of action: ${new Date(timestamp).toLocaleString()}`,
  });

  return embed;
}

module.exports = {
  BOT_LOG_KEYS,
  BOT_LOG_KEY_LIST,
  BOT_ACTION_COLORS,
  buildBotLogEmbed,
  formatUser,
  formatChannel,
};
