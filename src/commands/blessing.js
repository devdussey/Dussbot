const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const coinStore = require('../utils/coinStore');
const rupeeStore = require('../utils/rupeeStore');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const logSender = require('../utils/logSender');
const { formatCurrencyAmount } = require('../utils/currencyName');

const DAILY_RUPEE = 1;

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blessing')
    .setDescription('Receive a daily blessing worth 1 currency'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Blessings are only tracked inside servers.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: 'Only administrators may run /blessing.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const status = coinStore.getPrayStatus(guildId, userId);

    if (!status.canPray) {
      const remaining = formatDuration(status.cooldownMs);
      return interaction.editReply({ content: `You have already received your blessing. Try again in ${remaining}.` });
    }

    await coinStore.recordPrayer(guildId, userId, 0);
    const newBalance = await rupeeStore.addTokens(guildId, userId, DAILY_RUPEE);

    try {
      const embed = buildRupeeEventEmbed({
        guildId,
        eventType: 'earned',
        actor: interaction.user,
        target: interaction.user,
        amount: DAILY_RUPEE,
        balance: newBalance,
        method: '/blessing',
      });
      await logSender.sendLog({
        guildId,
        logType: 'rupee_earned',
        embed,
        client: interaction.client,
      });
    } catch (err) {
      console.error('Failed to send blessing rupee log:', err);
    }

    return interaction.editReply({
      content: `✨ You receive a blessing and gain ${formatCurrencyAmount(guildId, DAILY_RUPEE, { lowercase: true })}! New balance: ${formatCurrencyAmount(guildId, newBalance, { lowercase: true })}.`,
    });
  },
};
