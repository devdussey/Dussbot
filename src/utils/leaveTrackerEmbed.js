const { EmbedBuilder } = require('discord.js');
const { applyDefaultColour } = require('./guildColourStore');

function formatLeaveTime(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  const time = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  return `Left on ${time} at ${dateStr}`;
}

function buildReasonText({ type = 'left', executorTag = null, executorId = null } = {}) {
  if (type === 'ban') {
    const by = executorTag || (executorId ? `User ID ${executorId}` : 'unknown');
    return `Banned by ${by}`;
  }
  if (type === 'kick') {
    const by = executorTag || (executorId ? `User ID ${executorId}` : 'unknown');
    return `Kicked by ${by}`;
  }
  return 'Left the server';
}

function buildLeaveEmbed(member, { leftAt = new Date(), leaveCount = 1, reason = {} } = {}) {
  const user = member?.user || member;
  const displayName = member?.displayName || user?.globalName || user?.username || 'Unknown';
  const username = user?.tag || user?.username || 'Unknown user';
  const userId = user?.id || 'Unknown ID';
  const thumbUrl = member?.displayAvatarURL?.({ dynamic: true })
    || user?.displayAvatarURL?.({ dynamic: true })
    || null;

  const reasonText = buildReasonText(reason);
  const embed = new EmbedBuilder()
    .setTitle('Member Left')
    .setDescription(formatLeaveTime(leftAt))
    .addFields(
      {
        name: 'Member',
        value: `Display Name: ${displayName}\nUsername: ${username}\nUser ID: ${userId}`,
        inline: false,
      },
      {
        name: 'Departure',
        value: reasonText,
        inline: false,
      },
      {
        name: 'Leaves Recorded',
        value: `${Number.isFinite(leaveCount) ? leaveCount : 0}`,
        inline: true,
      },
    )
    .setTimestamp(leftAt);

  try { applyDefaultColour(embed, member?.guild?.id); } catch (_) {}
  if (thumbUrl) embed.setThumbnail(thumbUrl);
  return embed;
}

module.exports = {
  buildLeaveEmbed,
  formatLeaveTime,
  buildReasonText,
};
