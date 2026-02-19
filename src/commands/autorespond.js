const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const store = require('../utils/autoRespondStore');
const { isLikelyExpiringDiscordUrl } = require('../utils/mediaAttachment');

const RULES_PER_PAGE = 5;
const LIST_PREFIX = 'autorespond:list';

function buildResponseLabel(rule) {
  const textPart = rule.reply ? rule.reply.replace(/\n/g, ' ') : null;
  const mediaPart = rule.mediaUrl ? `media ${rule.mediaUrl}` : null;
  const stickerPart = rule.stickerId ? `sticker ${rule.stickerId}` : null;
  const merged = [textPart, mediaPart, stickerPart].filter(Boolean).join(' + ');
  return merged || 'empty response';
}

function buildListView(guildId, page = 0) {
  const cfg = store.getGuildConfig(guildId);
  const totalPages = Math.max(1, Math.ceil(cfg.rules.length / RULES_PER_PAGE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const start = safePage * RULES_PER_PAGE;
  const rules = cfg.rules.slice(start, start + RULES_PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle('Autorespond Rules')
    .setDescription(
      cfg.rules.length
        ? rules.map(rule => `ID#${rule.id} | (${buildResponseLabel(rule)}) <${rule.trigger}>`).join('\n')
        : 'No rules configured. Use /autorespond add to create one.'
    )
    .addFields({ name: 'Status', value: cfg.enabled ? 'ENABLED' : 'DISABLED', inline: true })
    .setFooter({ text: `Page ${safePage + 1}/${totalPages} • ${cfg.rules.length} total rule(s)` });

  const components = [];
  if (rules.length) {
    const deleteRow = new ActionRowBuilder();
    for (const rule of rules) {
      deleteRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`${LIST_PREFIX}:delete:${rule.id}:${safePage}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel(`Delete #${rule.id}`)
      );
    }
    components.push(deleteRow);
  }

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${LIST_PREFIX}:page:${safePage - 1}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Previous')
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId(`${LIST_PREFIX}:page:${safePage + 1}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next')
          .setDisabled(safePage >= totalPages - 1),
      )
    );
  }

  return {
    embeds: [embed],
    components,
  };
}

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

      let parsedMediaUrl = null;
      if (trimmedMediaUrl) {
        try { parsedMediaUrl = new URL(trimmedMediaUrl); } catch (_) {}
        if (!parsedMediaUrl || !['http:', 'https:'].includes(parsedMediaUrl.protocol)) {
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
      const mediaUrlWarning = parsedMediaUrl && isLikelyExpiringDiscordUrl(parsedMediaUrl)
        ? ' Warning: that looks like an expiring Discord CDN link. Prefer a permanent media URL so autorespond does not break later.'
        : '';
      const addedLine = `Added rule #${rule.id}: when ${match}${caseSensitive ? ' (case)' : ''} '${trigger}'${rule.channelId ? ` in <#${rule.channelId}>` : ''} -> ${responseLabel}.${mediaUrlWarning}`;
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
      const view = buildListView(guildId, 0);
      return interaction.editReply(view);
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },

  async handleButton(interaction) {
    if (!interaction.inGuild()) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith(`${LIST_PREFIX}:`)) {
      return false;
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      try { await interaction.reply({ content: 'Only server administrators can configure autorespond.', ephemeral: true }); } catch (_) {}
      return true;
    }

    const parts = interaction.customId.split(':');
    const action = parts[2];

    if (action === 'page') {
      const page = Number(parts[3] || 0);
      const view = buildListView(interaction.guildId, page);
      try { await interaction.update(view); } catch (_) {}
      return true;
    }

    if (action === 'delete') {
      const id = Number(parts[3]);
      const page = Number(parts[4] || 0);
      const removed = store.removeRule(interaction.guildId, id);
      const view = buildListView(interaction.guildId, page);
      const content = removed ? `Removed rule #${id}.` : `Rule #${id} no longer exists.`;
      try { await interaction.update({ content, ...view }); } catch (_) {}
      return true;
    }

    return false;
  },
};
