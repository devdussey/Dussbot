const path = require('node:path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const srcDirForThisModule = __dirname.includes(`${path.sep}dist${path.sep}`)
  ? __dirname.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
  : path.join(process.cwd(), 'src', 'commands');

function requireFromSrcIfNeeded(modulePath) {
  try {
    return require(modulePath);
  } catch (_) {
    return require(path.resolve(srcDirForThisModule, modulePath));
  }
}

const rupeeStore = requireFromSrcIfNeeded('../utils/rupeeStore');
const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');
const { getCurrencyName, formatCurrencyAmount, formatCurrencyWord } = requireFromSrcIfNeeded('../utils/currencyName');

function buildEmbed(guildId, entries, page) {
  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0x00f0ff))
    .setTitle(`${getCurrencyName(guildId)} Balances`)
    .setDescription(`Users with ${formatCurrencyWord(guildId, 2, { lowercase: true })}: **${entries.length}**`);

  const start = page * 20;
  const slice = entries.slice(start, start + 20);
  const lines = slice.map((entry, idx) => {
    const rank = start + idx + 1;
    return `${rank}. <@${entry.userId}> — **${formatCurrencyAmount(guildId, entry.tokens, { lowercase: true })}**`;
  });

  embed.addFields({
    name: 'Leaderboard',
    value: lines.length ? lines.join('\n') : `_No ${formatCurrencyWord(guildId, 2, { lowercase: true })} yet._`,
  });

  return embed;
}

function buildPagerComponents(total) {
  if (total <= 20) return [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('viewbalance:prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('viewbalance:next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(true),
  );
  return [row];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewbalance')
    .setDescription('View currency balances for this server')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return interaction.reply({ content: 'Only server administrators can use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const entries = rupeeStore.listUserBalances(interaction.guildId, { minTokens: 1 });
    const embed = buildEmbed(interaction.guildId, entries, 0);
    const components = buildPagerComponents(entries.length);

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  },
};

export {};
