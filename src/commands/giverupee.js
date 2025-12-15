const { SlashCommandBuilder } = require('discord.js');
const { isOwner } = require('../utils/ownerIds');
const rupeeStore = require('../utils/rupeeStore');
const premiumManager = require('../utils/premiumManager');

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

    const lines = [
      `<@${interaction.user.id}> has given <@${target.id}> ${amount} rupee${amount === 1 ? '' : 's'}.`,
      balanceLine,
      reasonLine,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1900);

    return interaction.reply({
      content: lines,
    });
  },
};

