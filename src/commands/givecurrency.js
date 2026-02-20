const cmdLogger = require('../utils/logger')('givecurrency');
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const logSender = require('../utils/logSender');
const { formatCurrencyAmount, formatCurrencyWord, getCurrencyPlural } = require('../utils/currencyName');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('givecurrency')
    .setDescription('Admins: grant economy currency to a user')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Member to receive currency')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('How much currency to grant (default 1)')
        .setMinValue(1)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Optional note for the recipient (max 200 characters)')
        .setMaxLength(200)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Only administrators can use this command.', ephemeral: true });
    }

    const target = interaction.options.getUser('user', true);
    const amountInput = interaction.options.getInteger('amount');
    const amount = Number.isFinite(amountInput) ? amountInput : 1;
    const reason = (interaction.options.getString('reason') || '').trim();

    const total = await rupeeStore.addTokens(interaction.guildId, target.id, amount);
    const currencyPlural = getCurrencyPlural(formatCurrencyWord(interaction.guildId, 1));

    const balanceLine = `They now have ${formatCurrencyAmount(interaction.guildId, total, { lowercase: true })}.`;
    const reasonLine = reason ? `Reason: ${reason}` : '';

    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(interaction.guildId, 0x00f0ff))
      .setTitle(`${currencyPlural} Granted`)
      .setDescription(`<@${interaction.user.id}> has given <@${target.id}> ${formatCurrencyAmount(interaction.guildId, amount, { lowercase: true })}.`)
      .addFields(
        { name: 'Amount awarded', value: formatCurrencyAmount(interaction.guildId, amount), inline: true },
        { name: 'New balance', value: balanceLine.replace('They now have ', '').replace('.', ''), inline: true },
      )
      .setTimestamp();

    if (reasonLine) {
      embed.addFields({ name: 'Reason', value: reasonLine.replace('Reason: ', '') });
    }

    try {
      const logEmbed = buildRupeeEventEmbed({
        guildId: interaction.guildId,
        eventType: 'given',
        actor: interaction.user,
        target,
        amount,
        balance: total,
        method: '/givecurrency',
        extraFields: reason ? [{ name: 'Reason', value: reason, inline: false }] : [],
      });
      await logSender.sendLog({
        guildId: interaction.guildId,
        logType: 'rupee_given',
        embed: logEmbed,
        client: interaction.client,
      });
    } catch (err) {
      cmdLogger.error('Failed to send givecurrency log:', err);
    }

    return interaction.reply({ embeds: [embed] });
  },
};

