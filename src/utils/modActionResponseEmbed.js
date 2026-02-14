const { EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('./guildColourStore');

function formatPerformedBy(interaction) {
  const actor = interaction?.user?.tag || 'Unknown';
  const at = new Date().toLocaleString();
  return `Performed by ${actor} at ${at}`;
}

function buildModActionEmbed(interaction, options = {}) {
  const {
    title = 'Moderation Action',
    targetUser = null,
    reason = null,
    color = 0x5865f2,
    extraFields = [],
    description = null,
  } = options;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(resolveEmbedColour(interaction?.guildId, color))
    .setFooter({ text: formatPerformedBy(interaction) })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  if (targetUser && typeof targetUser.displayAvatarURL === 'function') {
    embed.setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }));
  }

  if (reason) {
    embed.addFields({ name: 'Reason', value: String(reason).slice(0, 1024), inline: false });
  }

  for (const field of extraFields) {
    if (!field?.name || !field?.value) continue;
    embed.addFields({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: field.inline === true,
    });
  }

  return embed;
}

module.exports = {
  buildModActionEmbed,
};
