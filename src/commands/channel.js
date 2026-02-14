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
    )
    .addSubcommand(sub =>
      sub
        .setName('sync')
        .setDescription('Sync child channel permissions with their parent category')
        .addChannelOption(opt =>
          opt.setName('category')
            .setDescription('Limit to a specific category')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('dry_run')
            .setDescription('Show what would change without applying it')
            .setRequired(false)
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

      if (sub === 'sync') {
        await interaction.deferReply({ ephemeral: true });
        const category = interaction.options.getChannel('category');
        const dryRun = interaction.options.getBoolean('dry_run') ?? false;

        const candidates = [];
        const validTypes = new Set([
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildForum,
          ChannelType.GuildMedia,
        ]);

        for (const ch of interaction.guild.channels.cache.values()) {
          if (!validTypes.has(ch.type)) continue;
          if (!ch.parentId) continue;
          if (category && ch.parentId !== category.id) continue;
          candidates.push(ch);
        }

        if (!candidates.length) {
          const scope = category ? `in ${category.name}` : 'in this server';
          return interaction.editReply({ content: `No child channels found to sync ${scope}.` });
        }

        let ok = 0;
        let fail = 0;
        const errors = [];
        for (const ch of candidates) {
          if (dryRun) {
            ok += 1;
            continue;
          }
          try {
            await ch.lockPermissions(`Requested by ${interaction.user.tag} (${interaction.user.id}) via /channel sync`);
            ok += 1;
          } catch (err) {
            fail += 1;
            if (errors.length < 5) errors.push(`${ch.name}: ${err.message || 'error'}`);
          }
        }

        const scope = category ? `for category ${category.name}` : 'across all categories';
        const summary = dryRun
          ? `Dry run: would sync ${ok} channel(s) ${scope}.`
          : `Synced ${ok} channel(s) ${scope}${fail ? `; ${fail} failed` : ''}.`;

        if (errors.length) {
          return interaction.editReply({ content: `${summary}\nIssues:\n- ${errors.join('\n- ')}` });
        }
        return interaction.editReply({ content: summary });
      }

      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Failed to ${sub} channel: ${error.message || 'Unknown error'}`, ephemeral: true });
    }
  },
};
