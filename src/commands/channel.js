const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const modlog = require('../utils/modLogger');

function buildAuditReason(interaction, action) {
  return `By ${interaction.user.tag} (${interaction.user.id}) via /channel ${action}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Create or edit channels (admin only)')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new text channel')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Channel name')
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt.setName('category')
            .setDescription('Category to place the channel inside')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Rename an existing channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel to rename')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('name_edit')
            .setDescription('New channel name')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ content: 'I need the Manage Channels permission.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const auditReason = buildAuditReason(interaction, sub);

    try {
      if (sub === 'create') {
        const rawName = (interaction.options.getString('name', true) || '').trim();
        if (!rawName) {
          return interaction.reply({ content: 'Provide a valid channel name.', ephemeral: true });
        }
        const name = rawName.slice(0, 100);
        const category = interaction.options.getChannel('category');

        const channel = await interaction.guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: category?.id ?? undefined,
          reason: auditReason,
        });

        try {
          await modlog.log(interaction, 'Channel Created', {
            target: `${channel} (${channel.id})`,
            reason: category ? `Category: ${category.name}` : 'No category',
          });
        } catch (_) {}

        return interaction.reply({
          content: `Created text channel ${channel.toString()}${category ? ` in ${category.toString()}` : ''}.`,
          ephemeral: true,
        });
      }

      if (sub === 'edit') {
        const channel = interaction.options.getChannel('channel', true);
        const rawNewName = (interaction.options.getString('name_edit') || '').trim();
        if (!rawNewName) {
          return interaction.reply({ content: 'Provide a new name for the channel.', ephemeral: true });
        }
        const newName = rawNewName.slice(0, 100);

        await channel.edit({ name: newName, reason: auditReason });

        try {
          await modlog.log(interaction, 'Channel Updated', {
            target: `${channel} (${channel.id})`,
            reason: `Renamed to ${newName}`,
          });
        } catch (_) {}

        return interaction.reply({ content: `Renamed ${channel.toString()} to ${newName}.`, ephemeral: true });
      }

      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Failed to ${sub} channel: ${error.message || 'Unknown error'}`, ephemeral: true });
    }
  },
};
