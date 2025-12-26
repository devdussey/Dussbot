const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function pluralize(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewrupees')
    .setDescription("Admins: view a member's Rupee balance")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false)
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Member to view')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'Only server administrators can use this command.' });
    }

    const target = interaction.options.getUser('user', true);
    const stats = rupeeStore.getProgress(interaction.guildId, target.id);

    const rupees = Number.isFinite(stats.tokens) ? stats.tokens : 0;
    const progress = Number.isFinite(stats.progress) ? stats.progress : 0;
    const messagesUntilNext = Number.isFinite(stats.messagesUntilNext) ? stats.messagesUntilNext : rupeeStore.AWARD_THRESHOLD;
    const totalMessages = Number.isFinite(stats.totalMessages) ? stats.totalMessages : 0;

    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(interaction.guildId, 0x2ecc71))
      .setTitle('Rupee Balance')
      .setDescription(`<@${target.id}> has **${rupees}** ${pluralize(rupees, 'rupee')}.`)
      .addFields(
        { name: 'Progress', value: `${progress}/${rupeeStore.AWARD_THRESHOLD} messages toward next rupee`, inline: false },
        { name: 'Next Rupee In', value: `${messagesUntilNext} ${pluralize(messagesUntilNext, 'message')}`, inline: true },
        { name: 'Total Tracked Messages', value: `${totalMessages}`, inline: true },
      );

    const avatarUrl = typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ forceStatic: true }) : null;
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return interaction.editReply({ embeds: [embed] });
  },
};

