const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { getCurrencyName, formatCurrencyAmount, formatCurrencyWord } = require('../utils/currencyName');

async function resolvePageEntries(guild, entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const resolved = await Promise.all(
    entries.map(async (entry) => {
      const userId = entry?.userId;
      if (!userId) return null;
      if (!guild) return entry;
      if (guild.members.cache.has(userId)) return entry;
      try {
        await guild.members.fetch(userId);
      } catch (_) {
        // Ignore missing users
      }
      return entry;
    })
  );
  return resolved.filter(Boolean);
}

async function buildLeaderboardEmbed({ guild, guildId, entries, pageIndex, perPage }) {
  const totalUsers = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalUsers / perPage));
  const safePage = Math.min(Math.max(0, pageIndex), totalPages - 1);
  const start = safePage * perPage;
  const pageEntries = entries.slice(start, start + perPage);
  const slice = await resolvePageEntries(guild, pageEntries);

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0x2ecc71))
    .setTitle(`💎 ${getCurrencyName(guildId)} Leaderboard`)
    .setDescription(
      totalUsers
        ? `Top ${formatCurrencyWord(guildId, 2, { lowercase: true })} holders in this server.\nPage **${safePage + 1}/${totalPages}**`
        : `No users have any ${formatCurrencyWord(guildId, 2, { lowercase: true })} yet.`
    );

  if (slice.length) {
    const lines = slice.map((e, idx) => {
      const rank = start + idx + 1;
      return `${rank}. <@${e.userId}> — **${formatCurrencyAmount(guildId, e.tokens, { lowercase: true })}**`;
    });
    embed.addFields({ name: 'Leaderboard', value: lines.join('\n').slice(0, 1024) });
  }

  return { embed, totalPages, pageIndex: safePage };
}

function buildPagerRow({ pageIndex, totalPages, prevId, nextId }) {
  if (totalPages <= 1) return null;
  const prev = new ButtonBuilder()
    .setCustomId(prevId)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Prev')
    .setDisabled(pageIndex <= 0);

  const next = new ButtonBuilder()
    .setCustomId(nextId)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next')
    .setDisabled(pageIndex >= totalPages - 1);

  return new ActionRowBuilder().addComponents(prev, next);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('currencybalances')
    .setDescription('View the currency leaderboard')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply();

    const entries = rupeeStore.listUserBalances(interaction.guildId, { minTokens: 1 });
    const perPage = 10;
    let pageIndex = 0;

    const prevId = `currencybalances:prev:${interaction.id}`;
    const nextId = `currencybalances:next:${interaction.id}`;

    const initial = await buildLeaderboardEmbed({
      guild: interaction.guild,
      guildId: interaction.guildId,
      entries,
      pageIndex,
      perPage,
    });
    pageIndex = initial.pageIndex;

    let totalPages = initial.totalPages;
    const row = buildPagerRow({
      pageIndex,
      totalPages,
      prevId,
      nextId,
    });

    const message = await interaction.editReply({
      embeds: [initial.embed],
      components: row ? [row] : [],
    });

    if (!row || !message) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'This menu is not for you.', ephemeral: true });
      }

      if (i.customId === prevId) pageIndex = Math.max(0, pageIndex - 1);
      if (i.customId === nextId) pageIndex = Math.min(pageIndex + 1, totalPages - 1);

      const next = await buildLeaderboardEmbed({
        guild: interaction.guild,
        guildId: interaction.guildId,
        entries,
        pageIndex,
        perPage,
      });
      pageIndex = next.pageIndex;
      totalPages = next.totalPages;

      const nextRow = buildPagerRow({
        pageIndex,
        totalPages,
        prevId,
        nextId,
      });

      await i.update({
        embeds: [next.embed],
        components: nextRow ? [nextRow] : [],
      });
    });

    collector.on('end', () => {
      const disabledRow = buildPagerRow({
        pageIndex,
        totalPages,
        prevId,
        nextId,
      });
      if (disabledRow) {
        disabledRow.components.forEach((c) => c.setDisabled(true));
      }
      interaction.editReply({ components: disabledRow ? [disabledRow] : [] }).catch(() => {});
    });
  },
};
