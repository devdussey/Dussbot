const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOwner } = require('../utils/ownerIds');
const rupeeStore = require('../utils/rupeeStore');
const premiumManager = require('../utils/premiumManager');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const logSender = require('../utils/logSender');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giverupee')
    .setDescription('Owners: grant Rupees to a user')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Member to receive Rupees')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('How many Rupees to grant (default 1)')
        .setMinValue(1)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Optional note for the recipient (max 200 characters)')
        .setMaxLength(200)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!(await premiumManager.ensurePremium(interaction, 'Give Rupee'))) return;

    const isBotOwner = isOwner(interaction.user.id);
    let isGuildOwner = false;
    if (interaction.guild && interaction.guild.ownerId) {
      isGuildOwner = interaction.guild.ownerId === interaction.user.id;
    }
    if (!isGuildOwner && interaction.guild && interaction.guild.fetchOwner) {
      try {
        const owner = await interaction.guild.fetchOwner();
        if (owner && owner.id === interaction.user.id) {
          isGuildOwner = true;
        }
      } catch (_) {
        // ignore fetch errors and fall back to known state
      }
    }

    if (!isBotOwner && !isGuildOwner) {
      return interaction.reply({ content: 'Only the bot owner or the guild owner can use this command.', ephemeral: true });
    }

    const target = interaction.options.getUser('user', true);
    const amountInput = interaction.options.getInteger('amount');
    const amount = Number.isFinite(amountInput) ? amountInput : 1;
    const reason = (interaction.options.getString('reason') || '').trim();

    const total = await rupeeStore.addTokens(interaction.guildId, target.id, amount);

    const balanceLine = `They now have ${total} rupee${total === 1 ? '' : 's'}.`;
    const reasonLine = reason ? `Reason: ${reason}` : '';

    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(interaction.guildId, 0x00f0ff))
      .setTitle('Rupees granted')
      .setDescription(`<@${interaction.user.id}> has given <@${target.id}> ${amount} rupee${amount === 1 ? '' : 's'}.`)
      .addFields(
        { name: 'Amount awarded', value: `${amount} rupee${amount === 1 ? '' : 's'}`, inline: true },
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
        method: '/giverupee',
        extraFields: reason ? [{ name: 'Reason', value: reason, inline: false }] : [],
      });
      await logSender.sendLog({
        guildId: interaction.guildId,
        logType: 'rupee_given',
        embed: logEmbed,
        client: interaction.client,
      });
    } catch (err) {
      console.error('Failed to send giverupee log:', err);
    }

    return interaction.reply({ embeds: [embed] });
  },
};
