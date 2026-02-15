const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const store = require('../utils/autoRespondStore');

async function resolveGuildSticker(guild, value) {
  if (!guild || !value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^[0-9]{15,25}$/.test(raw)) {
    try {
      return await guild.stickers.fetch(raw);
    } catch (_) {}
  }

  const lowerNeedle = raw.toLowerCase();
  let found = guild.stickers.cache.get(raw) || null;
  if (!found) {
    found = guild.stickers.cache.find(sticker => sticker.name.toLowerCase() === lowerNeedle) || null;
  }
  if (found) return found;

  try {
    const fetched = await guild.stickers.fetch();
    return fetched.get(raw) || fetched.find(sticker => sticker.name.toLowerCase() === lowerNeedle) || null;
  } catch (_) {
    return null;
  }
}

function chunkLines(lines, maxLength = 1900) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const text = String(line || '');
    if (!text) continue;
    const withBreak = current ? `\n${text}` : text;

    if ((current + withBreak).length <= maxLength) {
      current += withBreak;
      continue;
    }

    if (current) chunks.push(current);

    if (text.length <= maxLength) {
      current = text;
      continue;
    }

    // Fallback for unexpectedly long single lines.
    let remaining = text;
    while (remaining.length > maxLength) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    current = remaining;
  }

  if (current) chunks.push(current);
  return chunks;
}

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
          opt.setName('sticker')
            .setDescription('Server sticker ID or exact sticker name')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('match')
            .setDescription('Match mode: contains(anywhere), exact(whole msg), starts_with(beginning)')
            .addChoices(
              { name: 'contains - trigger appears anywhere in the message', value: 'contains' },
              { name: 'exact match - message must equal trigger', value: 'equals' },
              { name: 'starts with - message must begin with trigger', value: 'starts_with' },
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
      const stickerInput = interaction.options.getString('sticker') || '';
      const match = interaction.options.getString('match') || 'contains';
      const caseSensitive = interaction.options.getBoolean('case_sensitive') || false;
      const channel = interaction.options.getChannel('channel');

      const trimmedReply = reply.trim();
      const trimmedMediaUrl = mediaUrl.trim();
      const trimmedStickerInput = stickerInput.trim();

      if (trimmedMediaUrl) {
        let parsed = null;
        try { parsed = new URL(trimmedMediaUrl); } catch (_) {}
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          return interaction.editReply({ content: 'The `media_url` must be a valid `http` or `https` URL.' });
        }
      }

      let sticker = null;
      if (trimmedStickerInput) {
        sticker = await resolveGuildSticker(interaction.guild, trimmedStickerInput);
        if (!sticker) {
          return interaction.editReply({ content: 'Could not find that server sticker. Use a sticker ID or exact sticker name from this server.' });
        }
      }

      if (!trimmedReply && !trimmedMediaUrl && !sticker) {
        return interaction.editReply({ content: 'Provide at least one response type: `reply`, `media_url`, or `sticker`.' });
      }

      const rule = store.addRule(guildId, {
        trigger,
        reply: trimmedReply,
        mediaUrl: trimmedMediaUrl,
        stickerId: sticker?.id || '',
        match,
        caseSensitive,
        channelId: channel?.id || null,
      });
      // Enabling autorespond automatically if adding first rule
      try {
        const cfg = store.getGuildConfig(guildId);
        if (!cfg.enabled) store.setEnabled(guildId, true);
      } catch (_) {}
      const responseLabel = [
        rule.reply ? `text '${rule.reply}'` : null,
        rule.mediaUrl ? `media ${rule.mediaUrl}` : null,
        rule.stickerId ? `sticker ${sticker?.name || rule.stickerId}` : null,
      ].filter(Boolean).join(' + ');
      const addedLine = `Added rule #${rule.id}: when ${match}${caseSensitive ? ' (case)' : ''} '${trigger}'${rule.channelId ? ` in <#${rule.channelId}>` : ''} -> ${responseLabel}.`;
      const chunks = chunkLines([addedLine], 1850);
      if (chunks.length === 1) {
        return interaction.editReply({ content: chunks[0] });
      }

      await interaction.editReply({ content: `Added rule #${rule.id} (1/${chunks.length})\n${chunks[0]}` });
      for (let i = 1; i < chunks.length; i += 1) {
        await interaction.followUp({
          content: `Added rule #${rule.id} (${i + 1}/${chunks.length})\n${chunks[i]}`,
          ephemeral: true,
        });
      }
      return null;
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
          const stickerPart = r.stickerId ? `sticker ${r.stickerId}` : null;
          const output = [textPart, mediaPart, stickerPart].filter(Boolean).join(' + ') || '(empty response)';
          lines.push(`#${r.id}: [${r.match}${r.caseSensitive ? ', case' : ''}] '${r.trigger}' -> ${output}${r.channelId ? ` in <#${r.channelId}>` : ''}`);
        }
      }
      const chunks = chunkLines(lines, 1850);
      if (!chunks.length) {
        return interaction.editReply({ content: 'No rules configured. Use /autorespond add to create one.' });
      }

      if (chunks.length === 1) {
        return interaction.editReply({ content: chunks[0] });
      }

      await interaction.editReply({ content: `Autorespond rules (1/${chunks.length})\n${chunks[0]}` });
      for (let i = 1; i < chunks.length; i += 1) {
        await interaction.followUp({
          content: `Autorespond rules (${i + 1}/${chunks.length})\n${chunks[i]}`,
          ephemeral: true,
        });
      }
      return null;
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },
};
