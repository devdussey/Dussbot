const { EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('./guildColourStore');

function formatEntityLabel(value) {
  if (!value) return 'Unknown';
  if (typeof value === 'string') return value;
  if (value.tag || value.username || value.name) {
    const id = value.id || value.user?.id;
    const name = value.tag || value.username || value.name || value.user?.tag || 'Unknown';
    return id ? `${name} (${id})` : name;
  }
  if (typeof value.toString === 'function') {
    const rendered = value.toString();
    if (rendered && rendered !== '[object Object]') return rendered;
  }
  return 'Unknown';
}

function formatEntityMention(value) {
  if (!value) return 'Unknown';
  if (typeof value === 'string') return value;
  if (value.id) return `<@${value.id}>`;
  if (value.user?.id) return `<@${value.user.id}>`;
  return formatEntityLabel(value);
}

function resolveAvatar(value) {
  if (!value || typeof value === 'string') return null;
  if (typeof value.displayAvatarURL === 'function') {
    return value.displayAvatarURL({ extension: 'png', size: 256 });
  }
  if (typeof value.user?.displayAvatarURL === 'function') {
    return value.user.displayAvatarURL({ extension: 'png', size: 256 });
  }
  return null;
}

function normaliseAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function pluraliseRupee(amount) {
  return amount === 1 ? 'Rupee' : 'Rupees';
}

function getTitleForEvent(eventType) {
  if (eventType === 'earned') return 'Rupees Earned';
  if (eventType === 'given') return 'Rupees Given';
  return 'Rupees Spent';
}

function buildDefaultDescription({ eventType, actor, target, amount, method, itemLabel }) {
  const actorMention = formatEntityMention(actor);
  const targetMention = formatEntityMention(target);
  const amountText = `${amount} ${pluraliseRupee(amount)}`;
  if (eventType === 'earned') {
    return `${actorMention} has earned ${amountText} from ${method || 'an unknown method'}.`;
  }
  if (eventType === 'given') {
    if (target) {
      return `${actorMention} has given ${amountText} to ${targetMention} via ${method || 'an admin action'}.`;
    }
    return `${actorMention} has given ${amountText} via ${method || 'an admin action'}.`;
  }
  return `${actorMention} has spent ${amountText} on ${itemLabel || 'an item'}.`;
}

function buildRupeeEventEmbed({
  guildId,
  eventType = 'spend',
  actor,
  target = null,
  amount = 0,
  balance = null,
  method = null,
  itemLabel = null,
  description = null,
  extraFields = [],
  timestamp = new Date(),
}) {
  const safeAmount = normaliseAmount(amount);
  const actorLabel = formatEntityLabel(actor);
  const targetLabel = target ? formatEntityLabel(target) : 'N/A';
  const title = getTitleForEvent(eventType);
  const body = (description || buildDefaultDescription({
    eventType,
    actor,
    target,
    amount: safeAmount,
    method,
    itemLabel,
  })).slice(0, 3000);

  const balanceValue = Number.isFinite(Number(balance))
    ? `${normaliseAmount(balance)} ${pluraliseRupee(normaliseAmount(balance))}`
    : 'N/A';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${body}\nUsers Balance: ${balanceValue}`)
    .setColor(resolveEmbedColour(guildId, 0x00f0ff))
    .setTimestamp(timestamp)
    .setFooter({ text: `Date & Time: ${new Date(timestamp).toLocaleString()}` })
    .addFields(
      { name: 'Triggered By', value: actorLabel, inline: true },
      { name: 'Target', value: targetLabel, inline: true },
      { name: 'Amount', value: `${safeAmount} ${pluraliseRupee(safeAmount)}`, inline: true },
    );

  if (method) {
    embed.addFields({ name: 'Method', value: String(method).slice(0, 1024), inline: true });
  }

  if (itemLabel) {
    embed.addFields({ name: 'Item', value: String(itemLabel).slice(0, 1024), inline: true });
  }

  embed.addFields({ name: 'Users Balance', value: balanceValue, inline: true });

  const avatar = resolveAvatar(actor) || resolveAvatar(target);
  if (avatar) embed.setThumbnail(avatar);

  for (const field of (extraFields || [])) {
    if (!field?.name || !field?.value) continue;
    embed.addFields({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: Boolean(field.inline),
    });
  }

  return embed;
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
  return buildRupeeEventEmbed({
    guildId,
    eventType: 'spend',
    actor,
    target,
    amount: itemCost,
    balance,
    itemLabel,
    description,
    method: 'Rupee Store',
    extraFields,
  });
}

module.exports = {
  buildRupeeEventEmbed,
  buildRupeeSpendEmbed,
};
