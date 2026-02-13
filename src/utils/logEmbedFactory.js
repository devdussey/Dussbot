const { EmbedBuilder } = require('discord.js');

const DEFAULT_COLOR = 0x5865f2;

function formatPerson(person, fallback = 'System') {
  if (!person) return fallback;
  if (typeof person === 'string') return person;
  if (person.tag) return `${person.tag} (${person.id})`;
  if (person.name || person.id) return `${person.name || 'Unknown'} (${person.id || 'unknown'})`;
  return fallback;
}

function formatMention(person, fallback = 'Unknown User') {
  if (!person) return fallback;
  if (typeof person === 'string') return person;
  if (person.id) return `<@${person.id}>`;
  return formatPerson(person, fallback);
}

function resolveAvatar(target) {
  if (!target || typeof target === 'string') return null;
  if (typeof target.displayAvatarURL === 'function') {
    return target.displayAvatarURL({ extension: 'png', size: 128 });
  }
  if (typeof target.iconURL === 'function') {
    return target.iconURL({ extension: 'png', size: 128 });
  }
  return null;
}

function buildLogDescription({ action, target, actor, reason }) {
  const subject = formatMention(target, 'Unknown User');
  const actionLabel = String(action || 'Action').trim();
  const parts = [`${subject} has **${actionLabel}**.`];
  if (reason) parts.push(String(reason).slice(0, 1024));
  if (actor && actor !== target) {
    parts.push(`Triggered by: ${formatPerson(actor, 'System')}`);
  }
  return parts.join('\n');
}

function buildLogEmbed({
  action,
  target,
  actor,
  reason,
  color = DEFAULT_COLOR,
  timestamp = new Date(),
  extraFields = [],
  thumbnailTarget,
}) {
  const embed = new EmbedBuilder()
    .setTitle(action || 'Action')
    .setDescription(buildLogDescription({ action, target, actor, reason }))
    .setColor(color)
    .setTimestamp(timestamp)
    .setFooter({ text: `Date & Time: ${new Date(timestamp).toLocaleString()}` });

  embed.addFields(
    { name: 'User', value: formatPerson(target, 'Unknown User'), inline: true },
    { name: 'Action Performed By', value: formatPerson(actor, 'System'), inline: true },
  );

  for (const field of (extraFields || [])) {
    if (!field?.name || !field?.value) continue;
    embed.addFields({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: Boolean(field.inline),
    });
  }

  const avatarUrl = resolveAvatar(thumbnailTarget ?? target ?? actor);
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

module.exports = { buildLogEmbed };
