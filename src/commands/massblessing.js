const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const logSender = require('../utils/logSender');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('massblessing')
    .setDescription('Admins: grant every user a chosen number of rupees')
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('How many rupees each user should receive (default 1)')
        .setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return interaction.reply({ content: 'Only administrators can use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const amountInput = interaction.options.getInteger('amount');
    const amount = Number.isFinite(amountInput) ? amountInput : 1;

    let awarded = 0;
    try {
      const members = await interaction.guild.members.fetch();
      const userMembers = members.filter(m => !m.user.bot);
      for (const member of userMembers.values()) {
        await rupeeStore.addTokens(interaction.guildId, member.id, amount);
        awarded += 1;
      }
    } catch (err) {
      console.error('Failed to mass bless:', err);
      return interaction.editReply({ content: 'Failed to bless everyone. Please try again.' });
    }

    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(interaction.guildId, 0x00f0ff))
      .setTitle('✨ Mass Blessing')
      .setDescription(
        `Every non-bot user has received ${amount} rupee${amount === 1 ? '' : 's'}.\n` +
        `Total users blessed: ${awarded}.`
      )
      .setFooter({ text: 'Cooldowns are not affected by mass blessings.' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });

    try {
      const logEmbed = buildRupeeEventEmbed({
        guildId: interaction.guildId,
        eventType: 'given',
        actor: interaction.user,
        target: null,
        amount,
        balance: null,
        method: '/massblessing',
        description: `<@${interaction.user.id}> has given ${amount} rupee${amount === 1 ? '' : 's'} to ${awarded} users via /massblessing.`,
        extraFields: [
          { name: 'Users Blessed', value: String(awarded), inline: true },
          { name: 'Total Rupees Granted', value: String(awarded * amount), inline: true },
        ],
      });
      await logSender.sendLog({
        guildId: interaction.guildId,
        logType: 'rupee_given',
        embed: logEmbed,
        client: interaction.client,
      });
    } catch (err) {
      console.error('Failed to send massblessing log:', err);
    }

    try {
      await interaction.channel?.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (_) {}
  },
};
