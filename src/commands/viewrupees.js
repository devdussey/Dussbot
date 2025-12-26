const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function pluralize(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function buildLeaderboardEmbed({ guildId, entries, pageIndex, perPage }) {
  const totalUsers = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalUsers / perPage));
  const safePage = Math.min(Math.max(0, pageIndex), totalPages - 1);
  const start = safePage * perPage;
  const slice = entries.slice(start, start + perPage);

  const totalRupees = entries.reduce((sum, e) => sum + (Number.isFinite(e.tokens) ? e.tokens : 0), 0);

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0x2ecc71))
    .setTitle('Rupee Balances')
    .setDescription(
      totalUsers
        ? `Users with rupees: **${totalUsers}** • Total rupees tracked: **${totalRupees}**\nPage **${safePage + 1}/${totalPages}**`
        : 'No users have any rupees yet.'
    );

  if (slice.length) {
    const lines = slice.map((e, idx) => {
      const rank = start + idx + 1;
      return `${rank}. <@${e.userId}> — **${e.tokens}** ${pluralize(e.tokens, 'rupee')}`;
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
    .setLabel('◀')
    .setDisabled(pageIndex <= 0);

  const next = new ButtonBuilder()
    .setCustomId(nextId)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('▶')
    .setDisabled(pageIndex >= totalPages - 1);

  return new ActionRowBuilder().addComponents(prev, next);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewrupees')
    .setDescription('Admins: view rupee balances leaderboard')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Only server administrators can use this command.', ephemeral: true });
    }

    // Public leaderboard (admins only can invoke).
    await interaction.deferReply();

    const entries = rupeeStore.listUserBalances(interaction.guildId, { minTokens: 1 });
    const perPage = 20;
    let pageIndex = 0;

    const prevId = `viewrupees:prev:${interaction.id}`;
    const nextId = `viewrupees:next:${interaction.id}`;

    const initial = buildLeaderboardEmbed({
      guildId: interaction.guildId,
      entries,
      pageIndex,
      perPage,
    });
    pageIndex = initial.pageIndex;

    const row = buildPagerRow({
      pageIndex,
      totalPages: initial.totalPages,
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
      if (i.customId === nextId) pageIndex = pageIndex + 1;

      const next = buildLeaderboardEmbed({
        guildId: interaction.guildId,
        entries,
        pageIndex,
        perPage,
      });
      pageIndex = next.pageIndex;

      const nextRow = buildPagerRow({
        pageIndex,
        totalPages: next.totalPages,
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
        totalPages: initial.totalPages,
        prevId,
        nextId,
      });
      if (disabledRow) {
        disabledRow.components.forEach(c => c.setDisabled(true));
      }
      interaction.editReply({ components: disabledRow ? [disabledRow] : [] }).catch(() => {});
    });
  },
};
