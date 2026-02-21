const { EmbedBuilder } = require('discord.js');

function formatUser(user) {
  if (!user) return 'Unknown user';
  const tag = user.tag || user.username || user.globalName || user.name || user.id || 'Unknown';
  const id = user.id || 'unknown';
  return `${tag} (${id})`;
}

function resolveAvatar(user) {
  if (typeof user?.displayAvatarURL === 'function') {
    return user.displayAvatarURL({ extension: 'png', size: 256 }) || user.defaultAvatarURL || null;
  }
  if (typeof user?.avatarURL === 'function') {
    return user.avatarURL({ extension: 'png', size: 256 }) || user.defaultAvatarURL || null;
  }
  return user?.defaultAvatarURL || null;
}

function buildMemberLogEmbed({
  action,
  user,
  color,
  timestamp = new Date(),
  description = null,
  extraFields = [],
}) {
  const embed = new EmbedBuilder()
    .setTitle(action || 'Member Event')
    .setColor(color || 0x5865f2)
    .setTimestamp(timestamp)
    .addFields(
      { name: 'Action', value: action || 'Unknown', inline: true },
      { name: 'User', value: formatUser(user), inline: true },
    );

  if (description) {
    embed.setDescription(String(description).slice(0, 4096));
  }

  for (const field of extraFields.filter(Boolean)) {
    embed.addFields(field);
  }

  const avatar = resolveAvatar(user);
  if (avatar) {
    embed.setThumbnail(avatar);
  }

  embed.setFooter({
    text: `Date & time of action: ${new Date(timestamp).toLocaleString()}`,
    iconURL: avatar || undefined,
  });

  return embed;
}

module.exports = { buildMemberLogEmbed };
