const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const smiteConfigStore = require('../utils/smiteConfigStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rupeeconfig')
    .setDescription('Configure Rupee system settings for this server')
    .addBooleanOption(opt =>
      opt
        .setName('enabled')
        .setDescription('Turn Rupee rewards on or off')
        .setRequired(false)
    )
    .addRoleOption(opt =>
      opt
        .setName('immune_role')
        .setDescription('Role to add or remove from the Rupee punishing items immunity list')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('immune_action')
        .setDescription('Whether to add or remove the immune role (defaults to add).')
        .addChoices(
          { name: 'Add', value: 'add' },
          { name: 'Remove', value: 'remove' },
          { name: 'Clear all', value: 'clear' },
        )
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
    const immuneRole = interaction.options.getRole('immune_role');
    const immuneAction = interaction.options.getString('immune_action') || 'add';

    const hasRoleChange = immuneAction === 'clear' || !!immuneRole;
    if (immuneRole && immuneAction === 'clear') {
      return interaction.editReply({ content: 'Select add or remove when specifying an immune role.' });
    }

    const updates = [];
    let config = smiteConfigStore.getConfig(interaction.guildId);

    if (choice !== null) {
      config = await smiteConfigStore.setEnabled(interaction.guildId, choice);
      const status = config.enabled ? 'enabled' : 'disabled';
      updates.push(`Smite rewards have been **${status}**.`);
    }

    if (hasRoleChange) {
      if (immuneAction === 'clear') {
        config = await smiteConfigStore.setImmuneRoleIds(interaction.guildId, []);
        updates.push('Cleared all Smite immune roles.');
      } else if (immuneAction === 'remove') {
        config = await smiteConfigStore.removeImmuneRole(interaction.guildId, immuneRole.id);
        updates.push(`Removed ${immuneRole} from the Smite immune list.`);
      } else {
        config = await smiteConfigStore.addImmuneRole(interaction.guildId, immuneRole.id);
        updates.push(`Added ${immuneRole} to the Smite immune list.`);
      }
    }

    if (!updates.length) {
      const status = config.enabled ? 'enabled' : 'disabled';
      const immune = config.immuneRoleIds;
      const immuneList = immune.length
        ? immune.map(id => `<@&${id}>`).join(', ')
        : 'None';
      return interaction.editReply({
        content: `Smite rewards are currently **${status}** on this server.\nImmune roles: ${immuneList}.`,
      });
    }

    const immune = config.immuneRoleIds;
    const immuneList = immune.length
      ? immune.map(id => `<@&${id}>`).join(', ')
      : 'None';
    await interaction.editReply({
      content: `${updates.join(' ')}\nImmune roles: ${immuneList}.`,
    });
  },
};
