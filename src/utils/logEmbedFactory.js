const { EmbedBuilder } = require('discord.js');

const DEFAULT_COLOR = 0x5865f2;

function formatPerson(person, fallback = 'System') {
  if (!person) return fallback;
  if (typeof person === 'string') return person;
  if (person.tag) return `${person.tag} (${person.id})`;
  if (person.name || person.id) return `${person.name || 'Unknown'} (${person.id || 'unknown'})`;
  return fallback;
}

function resolveAvatar(target) {
  if (!target) return null;
  if (typeof target === 'string') return null;
  if (typeof target.displayAvatarURL === 'function') {
    return target.displayAvatarURL({ extension: 'png', size: 128 });
  }
  if (typeof target.iconURL === 'function') {
    return target.iconURL({ extension: 'png', size: 128 });
  }
  return null;
}

function buildLogEmbed({ action, target, actor, reason, color = DEFAULT_COLOR, timestamp = new Date(), extraFields = [], thumbnailTarget }) {
  const embed = new EmbedBuilder()
    .setTitle(action || 'Action')
    .setColor(color)
    .setTimestamp(timestamp);
  const userValue = formatPerson(target, 'Unknown User');
  const actorValue = formatPerson(actor, 'System');
  const reasonValue = reason ? String(reason).slice(0, 1024) : 'N/A';
  embed.addFields(
    { name: 'ACTION', value: action || 'Unknown', inline: false },
    { name: 'User', value: userValue, inline: true },
    { name: 'Reason/Specify', value: reasonValue, inline: true },
    { name: 'Action performed by', value: actorValue, inline: true },
    { name: 'Time', value: `<t:${Math.floor(timestamp.getTime() / 1000)}:f>`, inline: true },
  );
  for (const field of extraFields) {
    embed.addFields(field);
  }
  const avatarUrl = resolveAvatar(thumbnailTarget ?? target ?? actor);
  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }
  const footerIcon = resolveAvatar(actor);
  if (actor) {
    embed.setFooter({
      text: `Performed by ${formatPerson(actor, 'System')}`,
      iconURL: footerIcon || undefined,
    });
  }
  return embed;
}

module.exports = { buildLogEmbed };
