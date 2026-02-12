const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const store = require('../utils/autoRespondStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorespond')
    .setDescription('Configure simple auto responses to messages')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('toggle')
        .setDescription('Enable or disable autoresponses for this server')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Turn autorespond on or off')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add an autorespond rule')
        .addStringOption(opt =>
          opt.setName('trigger')
            .setDescription('Trigger text or regex pattern')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('reply')
            .setDescription('Reply text to send')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('media_url')
            .setDescription('Direct image or GIF URL to attach')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('match')
            .setDescription('How to match the trigger')
            .addChoices(
              { name: 'contains', value: 'contains' },
              { name: 'equals', value: 'equals' },
              { name: 'starts_with', value: 'starts_with' },
              { name: 'regex', value: 'regex' },
            )
        )
        .addBooleanOption(opt =>
          opt.setName('case_sensitive')
            .setDescription('Whether matching should be case sensitive')
        )
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Limit this rule to a specific channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove an autorespond rule by ID')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Rule ID (see /autorespond list)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List autorespond rules and status')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    // Require Administrator to configure
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'Only server administrators can configure autorespond.' });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const newState = store.setEnabled(guildId, enabled);
      return interaction.editReply({ content: `Autorespond is now ${newState ? 'ENABLED' : 'DISABLED'} for this server.` });
    }

    if (sub === 'add') {
      const trigger = interaction.options.getString('trigger', true);
      const reply = interaction.options.getString('reply') || '';
      const mediaUrl = interaction.options.getString('media_url') || '';
      const match = interaction.options.getString('match') || 'contains';
      const caseSensitive = interaction.options.getBoolean('case_sensitive') || false;
      const channel = interaction.options.getChannel('channel');

      const trimmedReply = reply.trim();
      const trimmedMediaUrl = mediaUrl.trim();
      if (!trimmedReply && !trimmedMediaUrl) {
        return interaction.editReply({ content: 'Provide at least one response type: `reply` text or `media_url`.' });
      }

      if (trimmedMediaUrl) {
        let parsed = null;
        try { parsed = new URL(trimmedMediaUrl); } catch (_) {}
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          return interaction.editReply({ content: 'The `media_url` must be a valid `http` or `https` URL.' });
        }
      }

      const rule = store.addRule(guildId, {
        trigger, reply: trimmedReply, mediaUrl: trimmedMediaUrl, match, caseSensitive, channelId: channel?.id || null,
      });
      // Enabling autorespond automatically if adding first rule
      try {
        const cfg = store.getGuildConfig(guildId);
        if (!cfg.enabled) store.setEnabled(guildId, true);
      } catch (_) {}
      const responseLabel = [
        rule.reply ? `text '${rule.reply}'` : null,
        rule.mediaUrl ? `media ${rule.mediaUrl}` : null,
      ].filter(Boolean).join(' + ');
      return interaction.editReply({ content: `Added rule #${rule.id}: when ${match}${caseSensitive ? ' (case)' : ''} '${trigger}'${rule.channelId ? ` in <#${rule.channelId}>` : ''} -> ${responseLabel}.` });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const ok = store.removeRule(guildId, id);
      return interaction.editReply({ content: ok ? `Removed rule #${id}.` : `Rule #${id} not found.` });
    }

    if (sub === 'list') {
      const cfg = store.getGuildConfig(guildId);
      const lines = [`Status: ${cfg.enabled ? 'ENABLED' : 'DISABLED'}`];
      if (!cfg.rules.length) {
        lines.push('No rules configured. Use /autorespond add to create one.');
      } else {
        for (const r of cfg.rules) {
          const textPart = r.reply ? `'${String(r.reply).replace(/\n/g, ' ')}'` : null;
          const mediaPart = r.mediaUrl ? `media ${r.mediaUrl}` : null;
          const output = [textPart, mediaPart].filter(Boolean).join(' + ') || '(empty response)';
          lines.push(`#${r.id}: [${r.match}${r.caseSensitive ? ', case' : ''}] '${r.trigger}' -> ${output}${r.channelId ? ` in <#${r.channelId}>` : ''}`);
        }
      }
      return interaction.editReply({ content: lines.join('\n') });
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },
};
