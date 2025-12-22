const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const smiteConfigStore = require('../utils/smiteConfigStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rupeeconfig')
    .setDescription('Enable or disable Rupee rewards')
    .addBooleanOption(opt =>
      opt
        .setName('enabled')
        .setDescription('Turn Rupee rewards on or off')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.editReply({ content: 'You need the Manage Server permission to configure Rupees.' });
    }

    const choice = interaction.options.getBoolean('enabled');
    if (choice === null) {
      const current = smiteConfigStore.getConfig(interaction.guildId);
      const status = current.enabled ? 'enabled' : 'disabled';
      return interaction.editReply({ content: `Smite rewards are currently **${status}** on this server.` });
    }

    const result = await smiteConfigStore.setEnabled(interaction.guildId, choice);
    const status = result.enabled ? 'enabled' : 'disabled';
    await interaction.editReply({ content: `Rupee rewards have been **${status}**.` });
  },
};
