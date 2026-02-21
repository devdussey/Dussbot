import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const communalStore = requireFromSrcIfNeeded('../utils/communalStore');
const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');
const { getCurrencyName, formatCurrencyAmount, formatCurrencyWord } = requireFromSrcIfNeeded('../utils/currencyName');

type BalanceEntry = {
  userId?: string;
  tokens?: number;
};

async function resolvePageEntries(guild: Guild | null, entries: BalanceEntry[]) {
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
    }),
  );
  return resolved.filter(Boolean) as BalanceEntry[];
}

async function buildLeaderboardEmbed({
  guild,
  guildId,
  entries,
  pageIndex,
  perPage,
}: {
  guild: Guild | null;
  guildId: string;
  entries: BalanceEntry[];
  pageIndex: number;
  perPage: number;
}) {
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
        : `No users have any ${formatCurrencyWord(guildId, 2, { lowercase: true })} yet.`,
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

function getUserRank(entries: BalanceEntry[], userId: string | undefined) {
  if (!Array.isArray(entries) || !userId) return null;
  const idx = entries.findIndex((entry) => entry?.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}

function buildUserBalanceEmbed({
  guildId,
  user,
  entries,
}: {
  guildId: string;
  user: { id: string };
  entries: BalanceEntry[];
}) {
  const balance = communalStore.getBalance(guildId, user.id);
  const rank = getUserRank(entries, user.id);

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0x2ecc71))
    .setTitle(`💎 ${getCurrencyName(guildId)} Balance`)
    .setDescription(`<@${user.id}> currently has **${formatCurrencyAmount(guildId, balance, { lowercase: true })}**.`);

  if (rank) {
    embed.addFields({
      name: 'Leaderboard Rank',
      value: `#${rank} of ${entries.length}`,
      inline: true,
    });
  } else {
    embed.addFields({
      name: 'Leaderboard Rank',
      value: 'Unranked (no tracked balance yet).',
      inline: true,
    });
  }

  return embed;
}

function buildPagerRow({ pageIndex, totalPages, prevId, nextId }: { pageIndex: number; totalPages: number; prevId: string; nextId: string }) {
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

  return new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next);
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('View server currency balances')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('leaderboard')
        .setDescription('View the server currency leaderboard'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('personal')
        .setDescription('View your personal balance'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('user')
        .setDescription('View another user balance')
        .addUserOption((opt) =>
          opt
            .setName('target')
            .setDescription('User to inspect')
            .setRequired(true))),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand(false) || 'leaderboard';

    if (subcommand === 'personal') {
      const entries = communalStore.listUserBalances(interaction.guildId, { minTokens: 0 });
      const embed = buildUserBalanceEmbed({
        guildId: interaction.guildId,
        user: interaction.user,
        entries,
      });
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'user') {
      const target = interaction.options.getUser('target', true);
      const entries = communalStore.listUserBalances(interaction.guildId, { minTokens: 0 });
      const embed = buildUserBalanceEmbed({
        guildId: interaction.guildId,
        user: target,
        entries,
      });
      return interaction.reply({ embeds: [embed] });
    }

    await interaction.deferReply();

    const entries = communalStore.listUserBalances(interaction.guildId, { minTokens: 1 });
    const perPage = 10;
    let pageIndex = 0;

    const prevId = `balance:prev:${interaction.id}`;
    const nextId = `balance:next:${interaction.id}`;

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

      try {
        await i.deferUpdate();
      } catch (_) {
        return;
      }

      if (i.customId === prevId) pageIndex = Math.max(0, pageIndex - 1);
      if (i.customId === nextId) pageIndex = Math.min(pageIndex + 1, totalPages - 1);

      const next = await buildLeaderboardEmbed({
        guild: interaction.guild,
        guildId: interaction.guildId!,
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

      await interaction.editReply({
        embeds: [next.embed],
        components: nextRow ? [nextRow] : [],
      }).catch(() => {});
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

export = command;
