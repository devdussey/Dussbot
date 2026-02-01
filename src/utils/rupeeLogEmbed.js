const { EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('./guildColourStore');

function formatEntityLabel(value) {
  if (!value) return 'Unknown';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') {
    const rendered = value.toString();
    if (rendered && rendered !== '[object Object]') {
      return rendered;
    }
  }
  if (value.tag || value.username || value.name) {
    const id = value.id || (value.user && value.user.id);
    const name = value.tag || value.username || value.name || (value.user && value.user.tag) || 'Unknown';
    return id ? `${name} (${id})` : name;
  }
  return 'Unknown';
}

function buildRupeeSpendEmbed({
  guildId,
  actor,
  itemLabel,
  itemCost = 0,
  target,
  balance = 0,
  description = null,
  extraFields = [],
}) {
  const displayBalance = Number.isFinite(balance) ? Math.floor(balance) : balance;
  const embed = new EmbedBuilder()
    .setTitle('Rupee Store Purchase')
    .setColor(resolveEmbedColour(guildId, 0x00f0ff))
    .setTimestamp(new Date());

  const actorLabel = formatEntityLabel(actor);
  const targetLabel = formatEntityLabel(target);
  const itemCostValue = Number.isFinite(itemCost) ? Math.floor(itemCost) : itemCost;

  const descriptionParts = [];
  if (description) descriptionParts.push(description);
  descriptionParts.push(`💰 ${actorLabel} spent ${itemCostValue} rupee${itemCostValue === 1 ? '' : 's'} on ${itemLabel}.`);
  descriptionParts.push(`🎯 Target: ${targetLabel}`);
  descriptionParts.push(`💎 Balance after spend: ${displayBalance} rupee${displayBalance === 1 ? '' : 's'}`);
  embed.setDescription(descriptionParts.join('\n'));

  embed.addFields(
    { name: 'Purchaser', value: actorLabel, inline: true },
    { name: 'Item', value: `${itemLabel} — ${itemCostValue} rupee${itemCostValue === 1 ? '' : 's'}`, inline: true },
    { name: 'Target', value: targetLabel, inline: true },
    { name: 'Remaining balance', value: `${displayBalance} rupee${displayBalance === 1 ? '' : 's'}`, inline: true },
  );

  for (const field of (extraFields || [])) {
    if (field && field.name && field.value) {
      embed.addFields({
        name: field.name.slice(0, 256),
        value: field.value.slice(0, 1024),
        inline: Boolean(field.inline),
      });
    }
  }

  return embed;
}

module.exports = {
  buildRupeeSpendEmbed,
};
