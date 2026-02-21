import { EmbedBuilder, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

const cmdLogger = require('../utils/logger')('donate');
const communalStore = require('../utils/communalStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const logSender = require('../utils/logSender');
const { formatCurrencyAmount, formatCurrencyWord, getCurrencyPlural } = require('../utils/currencyName');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('donate')
    .setDescription('Admins: grant economy currency to a user')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Member to receive currency')
        .setRequired(true))
    .addIntegerOption((opt) =>
      opt
        .setName('amount')
        .setDescription('How much currency to grant (default 1)')
        .setMinValue(1))
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Optional note for the recipient (max 200 characters)')
        .setMaxLength(200))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Only administrators can use this command.', ephemeral: true });
    }

    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user', true);
    const amountInput = interaction.options.getInteger('amount');
    const amount = Number.isFinite(amountInput) ? amountInput : 1;
    const reason = (interaction.options.getString('reason') || '').trim();

    const total = await communalStore.addTokens(guildId, target.id, amount);
    const currencyPlural = getCurrencyPlural(formatCurrencyWord(guildId, 1));

    const balanceLine = `They now have ${formatCurrencyAmount(guildId, total, { lowercase: true })}.`;
    const reasonLine = reason ? `Reason: ${reason}` : '';

    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(guildId, 0x00f0ff))
      .setTitle(`${currencyPlural} Granted`)
      .setDescription(`<@${interaction.user.id}> has given <@${target.id}> ${formatCurrencyAmount(guildId, amount, { lowercase: true })}.`)
      .addFields(
        { name: 'Amount awarded', value: formatCurrencyAmount(guildId, amount), inline: true },
        { name: 'New balance', value: balanceLine.replace('They now have ', '').replace('.', ''), inline: true })
      .setTimestamp();

    if (reasonLine) {
      embed.addFields({ name: 'Reason', value: reasonLine.replace('Reason: ', '') });
    }

    try {
      const logEmbed = buildRupeeEventEmbed({
        guildId,
        eventType: 'given',
        actor: interaction.user,
        target,
        amount,
        balance: total,
        method: '/donate',
        extraFields: reason ? [{ name: 'Reason', value: reason, inline: false }] : [],
      });
      await logSender.sendLog({
        guildId,
        logType: 'rupee_given',
        embed: logEmbed,
        client: interaction.client,
      });
    } catch (err) {
      cmdLogger.error('Failed to send donate log:', err);
    }

    return interaction.reply({ embeds: [embed] });
  },
};

export = command;
