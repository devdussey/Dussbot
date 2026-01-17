const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('massblessing')
    .setDescription('Admins: grant every user 1 rupee')
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

    let awarded = 0;
    try {
      const members = await interaction.guild.members.fetch();
      const userMembers = members.filter(m => !m.user.bot);
      for (const member of userMembers.values()) {
        await rupeeStore.addTokens(interaction.guildId, member.id, 1);
        awarded += 1;
      }
    } catch (err) {
      console.error('Failed to mass bless:', err);
      return interaction.editReply({ content: 'Failed to bless everyone. Please try again.' });
    }

    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(interaction.guildId, 0x00f0ff))
      .setTitle('✨ Mass Blessing')
      .setDescription(`Every non-bot user has received 1 rupee.\nTotal users blessed: ${awarded}.`)
      .setFooter({ text: 'Cooldowns are not affected by mass blessings.' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });

    try {
      await interaction.channel?.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (_) {}
  },
};
