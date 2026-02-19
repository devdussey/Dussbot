const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const coinStore = require('../utils/coinStore');
const rupeeStore = require('../utils/rupeeStore');
const tokenStore = require('../utils/messageTokenStore');
const smiteConfigStore = require('../utils/smiteConfigStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { getRupeeCost } = require('../utils/economyConfig');
const { formatCurrencyAmount, formatCurrencyWord, getCurrencyPlural } = require('../utils/currencyName');

function formatCoins(value) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (seconds > 0 && parts.length < 2) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : '0 seconds';
}

function buildInventoryEmbed({
  guildId,
  user,
  coinSummary,
  rupeeBalance,
  rupeeCost,
  prayStatus,
}) {
  const currencySingular = formatCurrencyWord(guildId, 1);
  const currencyPlural = getCurrencyPlural(currencySingular);
  const username = user && typeof user.username === 'string' && user.username.trim().length
    ? user.username
    : null;
  const title = username ? `${username}'s Divine Inventory` : 'Your Divine Inventory';

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0xf1c40f))
    .setTitle(title)
    .setDescription(
      'Your sacred belongings, tallied and catalogued. Spend coins in /store to expand your arsenal.'
    )
    .addFields(
      {
        name: '💰 Coins',
        value: `**Balance:** ${formatCoins(coinSummary.coins)}\n**Ledger:** Earned ${formatCoins(
          coinSummary.lifetimeEarned
        )} | Spent ${formatCoins(
          coinSummary.lifetimeSpent
        )}\nCoins are the divine currency for other features and upgrades.`,
      },
      {
        name: '⚡ Smites',
        value: `**Owned:** ${tokenStore.getBalance(guildId, user?.id)}\n**Cost:** 200 coins each\nSmite rewards are currently **${smiteConfigStore.isEnabled(guildId) ? 'enabled' : 'disabled'}**.`,
      },
      {
        name: `💎 ${currencyPlural}`,
        value: `**Owned:** ${rupeeBalance}\n**Cost:** ${formatCoins(
          rupeeCost
        )} coins each\n${currencyPlural} unlock the powerful /analysis command, can be granted by admins using /giverupee, and are spent in the configured store panel channel.`,
      }
    );

  embed.addFields({
    name: '🙏 Blessing',
    value: prayStatus.canPray
      ? `Ready! Use /blessing to receive ${formatCurrencyAmount(guildId, 1, { lowercase: true })}.`
      : `Already blessed. You can pray again in ${formatDuration(prayStatus.cooldownMs)}.`,
  });

  embed.addFields({
    name: `🏪 ${currencySingular} Shop`,
    value: 'Use the configured store panel channel to buy **STFU** (5), **Muzzle** (5), **Abuse Mod** (15), **Nickname** (5), **Nickname Another Member** (10), **Custom Role w/ Solid Colour** (5), **Custom Role w/ Gradient** (15), and **Guilt Free @everyone ping with message** (15).',
  });

  const avatarUrl = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ forceStatic: true }) : null;
  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  embed.setFooter({ text: 'Visit the Divine Store to trade your blessings for power.' });

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Check your economy inventory'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server to view your items.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const coinSummary = coinStore.getSummary(guildId, userId);
    const rupeeBalance = rupeeStore.getBalance(guildId, userId);
    const rupeeCost = getRupeeCost();
    const prayStatus = coinStore.getPrayStatus(guildId, userId);

    const embed = buildInventoryEmbed({
      guildId,
      user: interaction.user,
      coinSummary,
      rupeeBalance,
      rupeeCost,
      prayStatus,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
