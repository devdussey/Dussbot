// @ts-nocheck
const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const store = require('../utils/autoRespondStore');
const { fetchMediaAttachment } = require('../utils/mediaAttachment');
const {
  deleteStoredMediaSync,
  storeRuleMediaBuffer,
} = require('../utils/autoRespondMediaStore');

const RULES_PER_PAGE = 5;
const LIST_PREFIX = 'autorespond:list';
const SELECT_PREFIX = `${LIST_PREFIX}:select`;
const EDIT_MODAL_PREFIX = `${LIST_PREFIX}:editmodal`;
const VALID_MATCH_TYPES = new Set(['contains', 'equals', 'starts_with', 'regex']);

const EDIT_FIELD_IDS = {
  trigger: 'autorespond:edit:trigger',
  reply: 'autorespond:edit:reply',
  mediaUrl: 'autorespond:edit:media_url',
  sticker: 'autorespond:edit:sticker',
  options: 'autorespond:edit:options',
};

function normalizeMatchType(value) {
  const match = String(value || 'contains').trim().toLowerCase();
  if (!VALID_MATCH_TYPES.has(match)) return 'contains';
  return match;
}

function formatMatchType(rule) {
  const mode = normalizeMatchType(rule?.match);
  const caseSuffix = rule?.caseSensitive ? 'case-sensitive' : 'case-insensitive';
  return `${mode} (${caseSuffix})`;
}

function truncateText(value, max = 80) {
  const text = String(value || '').trim();
  if (!text) return 'None';
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
}

function formatCreatedAt(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'Unknown';
  return `<t:${Math.floor(value / 1000)}:f>`;
}

function formatChannelLabel(channelId) {
  return channelId ? `<#${channelId}>` : 'All channels';
}

function buildContentSummary(rule, max = 75) {
  const parts = [];
  if (rule.reply) parts.push(`text: "${truncateText(String(rule.reply).replace(/\n/g, ' '), 40)}"`);
  if (rule.mediaUrl || rule.mediaStoredPath) parts.push('media');
  if (rule.stickerId) parts.push('sticker');
  return truncateText(parts.join(' + ') || 'None', max);
}

function hasRuleMedia(rule) {
  const mediaUrl = String(rule?.mediaUrl || '').trim();
  const mediaStoredPath = String(rule?.mediaStoredPath || '').trim();
  return Boolean(mediaUrl || mediaStoredPath);
}

function resolveAttachmentSourceUrl(attachment) {
  if (!attachment) return '';
  return String(attachment.url || attachment.proxyURL || '').trim();
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

function parseEditOptions(raw) {
  const updates = {};
  const text = String(raw || '').trim();
  if (!text) return { updates };

  const pieces = text.split(/[\n;]+/).map(part => part.trim()).filter(Boolean);
  for (const piece of pieces) {
    const idx = piece.indexOf('=');
    if (idx <= 0) {
      return { error: `Invalid option \`${piece}\`. Use \`key=value\` pairs.` };
    }

    const key = piece.slice(0, idx).trim().toLowerCase();
    const valueRaw = piece.slice(idx + 1).trim();
    const value = valueRaw.toLowerCase();

    if (key === 'match') {
      if (!VALID_MATCH_TYPES.has(value)) {
        return { error: 'Invalid match type. Use contains, equals, starts_with, or regex.' };
      }
      updates.match = value;
      continue;
    }

    if (key === 'case' || key === 'case_sensitive') {
      if (['true', '1', 'yes', 'on'].includes(value)) {
        updates.caseSensitive = true;
        continue;
      }
      if (['false', '0', 'no', 'off'].includes(value)) {
        updates.caseSensitive = false;
        continue;
      }
      return { error: 'Invalid case value. Use true/false.' };
    }

    if (key === 'channel' || key === 'channel_id') {
      if (!value || ['none', 'all', '*'].includes(value)) {
        updates.channelId = null;
        continue;
      }
      if (!/^[0-9]{15,25}$/.test(valueRaw)) {
        return { error: 'Invalid channel value. Use a channel ID or `all`.' };
      }
      updates.channelId = valueRaw;
      continue;
    }

    return { error: `Unknown option key \`${key}\`.` };
  }

  return { updates };
}

function buildOverviewView(guildId, page = 0) {
  const cfg = store.getGuildConfig(guildId);
  const totalPages = Math.max(1, Math.ceil(cfg.rules.length / RULES_PER_PAGE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const start = safePage * RULES_PER_PAGE;
  const rules = cfg.rules.slice(start, start + RULES_PER_PAGE);

  const description = cfg.rules.length
    ? rules.map(rule => (
      `**#${rule.id}** | Trigger: \`${truncateText(rule.trigger, 35)}\` | `
      + `Content: ${buildContentSummary(rule, 45)} | `
      + `Channel: ${formatChannelLabel(rule.channelId)} | `
      + `Type: ${formatMatchType(rule)} | `
      + `Date created: ${formatCreatedAt(rule.createdAt)}`
    )).join('\n')
    : 'No rules configured. Use `/autorespond add` to create one.';

  const embed = new EmbedBuilder()
    .setTitle('Autorespond Overview')
    .setDescription(description)
    .addFields({ name: 'Status', value: cfg.enabled ? 'ENABLED' : 'DISABLED', inline: true })
    .setFooter({ text: `Page ${safePage + 1}/${totalPages} • ${cfg.rules.length} total rule(s)` });

  const components = [];
  if (rules.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}:${safePage}`)
      .setPlaceholder('Select a rule to view details')
      .addOptions(
        rules.map(rule => ({
          label: `#${rule.id} ${truncateText(rule.trigger, 85)}`,
          description: truncateText(`${formatMatchType(rule)} | ${buildContentSummary(rule, 55)}`, 95),
          value: String(rule.id),
        })),
      );
    components.push(new ActionRowBuilder().addComponents(select));
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
      ),
    );
  }

  return {
    content: null,
    embeds: [embed],
    components,
  };
}

function buildRuleDetailView(guildId, ruleId, page = 0) {
  const cfg = store.getGuildConfig(guildId);
  const totalPages = Math.max(1, Math.ceil(cfg.rules.length / RULES_PER_PAGE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const rule = cfg.rules.find(item => item.id === Number(ruleId)) || null;

  if (!rule) {
    return {
      missing: true,
      page: safePage,
      ...buildOverviewView(guildId, safePage),
    };
  }

  const responseTypes = [];
  if (rule.reply) responseTypes.push('text');
  if (hasRuleMedia(rule)) responseTypes.push('media');
  if (rule.stickerId) responseTypes.push('sticker');

  const embed = new EmbedBuilder()
    .setTitle(`Autorespond Rule #${rule.id}`)
    .addFields(
      { name: 'Trigger', value: `\`${truncateText(rule.trigger, 250)}\``, inline: false },
      { name: 'Type', value: formatMatchType(rule), inline: true },
      { name: 'Channel', value: formatChannelLabel(rule.channelId), inline: true },
      { name: 'Date Created', value: formatCreatedAt(rule.createdAt), inline: true },
      { name: 'Response Types', value: responseTypes.join(', ') || 'None', inline: false },
      { name: 'Reply Content', value: truncateText(rule.reply, 1020), inline: false },
      { name: 'Media URL', value: rule.mediaUrl ? truncateText(rule.mediaUrl, 1020) : 'None', inline: false },
      { name: 'Stored Media', value: rule.mediaStoredPath ? `\`${truncateText(rule.mediaStoredPath, 1010)}\`` : 'None', inline: false },
      { name: 'Sticker', value: rule.stickerId ? `ID: \`${rule.stickerId}\`` : 'None', inline: false },
    )
    .setFooter({ text: `From page ${safePage + 1}` });

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${LIST_PREFIX}:edit:${rule.id}:${safePage}`)
      .setStyle(ButtonStyle.Primary)
      .setLabel('Edit'),
    new ButtonBuilder()
      .setCustomId(`${LIST_PREFIX}:delete:${rule.id}:${safePage}`)
      .setStyle(ButtonStyle.Danger)
      .setLabel('Delete'),
    new ButtonBuilder()
      .setCustomId(`${LIST_PREFIX}:back:${safePage}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Back to Overview'),
  );

  return {
    content: null,
    embeds: [embed],
    components: [actions],
  };
}

function buildEditModal(rule, page) {
  const modal = new ModalBuilder()
    .setCustomId(`${EDIT_MODAL_PREFIX}:${rule.id}:${Number(page) || 0}`)
    .setTitle(`Edit Autorespond #${rule.id}`);

  const triggerInput = new TextInputBuilder()
    .setCustomId(EDIT_FIELD_IDS.trigger)
    .setLabel('Trigger')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(300)
    .setRequired(true)
    .setValue(String(rule.trigger || '').slice(0, 300) || 'trigger');

  const replyInput = new TextInputBuilder()
    .setCustomId(EDIT_FIELD_IDS.reply)
    .setLabel('Reply Content (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(2000)
    .setRequired(false);
  if (rule.reply) replyInput.setValue(String(rule.reply).slice(0, 2000));

  const mediaInput = new TextInputBuilder()
    .setCustomId(EDIT_FIELD_IDS.mediaUrl)
    .setLabel('Media URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(1000)
    .setRequired(false);
  if (rule.mediaUrl) mediaInput.setValue(String(rule.mediaUrl).slice(0, 1000));

  const stickerInput = new TextInputBuilder()
    .setCustomId(EDIT_FIELD_IDS.sticker)
    .setLabel('Sticker ID or name (optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(64)
    .setRequired(false);
  if (rule.stickerId) stickerInput.setValue(String(rule.stickerId).slice(0, 64));

  const optionsInput = new TextInputBuilder()
    .setCustomId(EDIT_FIELD_IDS.options)
    .setLabel('Options: match/case/channel')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(300)
    .setPlaceholder('match=contains;case=false;channel=all')
    .setRequired(false)
    .setValue(`match=${normalizeMatchType(rule.match)};case=${rule.caseSensitive ? 'true' : 'false'};channel=${rule.channelId || 'all'}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(triggerInput),
    new ActionRowBuilder().addComponents(replyInput),
    new ActionRowBuilder().addComponents(mediaInput),
    new ActionRowBuilder().addComponents(stickerInput),
    new ActionRowBuilder().addComponents(optionsInput),
  );

  return modal;
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
            .setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add an autorespond rule')
        .addStringOption(opt =>
          opt.setName('trigger')
            .setDescription('Trigger text or regex pattern')
            .setRequired(true),
        )
        .addStringOption(opt =>
          opt.setName('reply')
            .setDescription('Reply text to send')
            .setRequired(false),
        )
        .addStringOption(opt =>
          opt.setName('media_url')
            .setDescription('Direct image or GIF URL to attach')
            .setRequired(false),
        )
        .addAttachmentOption(opt =>
          opt.setName('media_file')
            .setDescription('Upload media to store permanently for this rule')
            .setRequired(false),
        )
        .addStringOption(opt =>
          opt.setName('sticker')
            .setDescription('Server sticker ID or exact sticker name')
            .setRequired(false),
        )
        .addStringOption(opt =>
          opt.setName('match')
            .setDescription('Match mode: contains(anywhere), exact(whole msg), starts_with(beginning)')
            .addChoices(
              { name: 'contains - trigger appears anywhere in the message', value: 'contains' },
              { name: 'exact match - message must equal trigger', value: 'equals' },
              { name: 'starts with - message must begin with trigger', value: 'starts_with' },
            ),
        )
        .addBooleanOption(opt =>
          opt.setName('case_sensitive')
            .setDescription('Whether matching should be case sensitive'),
        )
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Limit this rule to a specific channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove an autorespond rule by ID')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Rule ID (see /autorespond list)')
            .setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List autorespond rules and status'),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: 'Use this in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

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
      const mediaFile = interaction.options.getAttachment('media_file');
      const stickerInput = interaction.options.getString('sticker') || '';
      const match = interaction.options.getString('match') || 'contains';
      const caseSensitive = interaction.options.getBoolean('case_sensitive') || false;
      const channel = interaction.options.getChannel('channel');

      const trimmedReply = reply.trim();
      const trimmedMediaUrl = mediaUrl.trim();
      const trimmedStickerInput = stickerInput.trim();
      const mediaFileUrl = resolveAttachmentSourceUrl(mediaFile);
      const sourceMediaUrl = trimmedMediaUrl || mediaFileUrl;

      if (trimmedMediaUrl && mediaFile) {
        return interaction.editReply({ content: 'Use either `media_url` or `media_file`, not both.' });
      }

      if (trimmedMediaUrl) {
        let parsed = null;
        try { parsed = new URL(trimmedMediaUrl); } catch (_) {}
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          return interaction.editReply({ content: 'The `media_url` must be a valid `http` or `https` URL.' });
        }
      }
      if (mediaFile && !mediaFileUrl) {
        return interaction.editReply({ content: 'Could not read the uploaded media file URL. Please re-upload and try again.' });
      }

      let sticker = null;
      if (trimmedStickerInput) {
        sticker = await resolveGuildSticker(interaction.guild, trimmedStickerInput);
        if (!sticker) {
          return interaction.editReply({ content: 'Could not find that server sticker. Use a sticker ID or exact sticker name from this server.' });
        }
      }

      if (!trimmedReply && !sourceMediaUrl && !sticker) {
        return interaction.editReply({ content: 'Provide at least one response type: `reply`, `media_url`, `media_file`, or `sticker`.' });
      }

      let preparedMedia = null;
      if (sourceMediaUrl) {
        preparedMedia = await fetchMediaAttachment(sourceMediaUrl);
        if (!preparedMedia) {
          return interaction.editReply({
            content: mediaFile
              ? 'The uploaded media file could not be downloaded or is not a supported image/video format.'
              : 'Could not download media from `media_url`, or the file type/size is not supported.',
          });
        }
      }

      const rule = store.addRule(guildId, {
        trigger,
        reply: trimmedReply,
        mediaUrl: sourceMediaUrl,
        stickerId: sticker?.id || '',
        match,
        caseSensitive,
        channelId: channel?.id || null,
      });

      if (preparedMedia) {
        try {
          const storedMedia = await storeRuleMediaBuffer(
            guildId,
            rule.id,
            preparedMedia.attachment,
            mediaFile?.name || preparedMedia.name,
          );
          if (!storedMedia) {
            store.removeRule(guildId, rule.id);
            return interaction.editReply({ content: 'Failed to store autorespond media. Rule was not saved.' });
          }
          const updatedRule = store.updateRule(guildId, rule.id, storedMedia);
          if (updatedRule) {
            rule.mediaStoredPath = updatedRule.mediaStoredPath;
            rule.mediaStoredName = updatedRule.mediaStoredName;
          }
        } catch (_) {
          store.removeRule(guildId, rule.id);
          return interaction.editReply({ content: 'Failed to store autorespond media. Rule was not saved.' });
        }
      }

      try {
        const cfg = store.getGuildConfig(guildId);
        if (!cfg.enabled) store.setEnabled(guildId, true);
      } catch (_) {}

      const responseLabel = [
        rule.reply ? `text '${rule.reply}'` : null,
        hasRuleMedia(rule) ? `media${rule.mediaStoredPath ? ' (stored)' : ''}${rule.mediaUrl ? ` ${rule.mediaUrl}` : ''}` : null,
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
      const view = buildOverviewView(guildId, 0);
      return interaction.editReply(view);
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },

  async handleSelectMenu(interaction) {
    if (!interaction.inGuild()) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith(`${SELECT_PREFIX}:`)) {
      return false;
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      try { await interaction.reply({ content: 'Only server administrators can configure autorespond.', ephemeral: true }); } catch (_) {}
      return true;
    }

    const parts = interaction.customId.split(':');
    const page = Number(parts[3] || 0);
    const selectedId = Number(interaction.values?.[0] || 0);
    const detail = buildRuleDetailView(interaction.guildId, selectedId, page);
    if (detail.missing) {
      try { await interaction.update({ content: `Rule #${selectedId} no longer exists.`, ...buildOverviewView(interaction.guildId, detail.page) }); } catch (_) {}
      return true;
    }

    try { await interaction.update(detail); } catch (_) {}
    return true;
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

    if (action === 'page' || action === 'back') {
      const page = Number(parts[3] || 0);
      const view = buildOverviewView(interaction.guildId, page);
      try { await interaction.update(view); } catch (_) {}
      return true;
    }

    if (action === 'delete') {
      const id = Number(parts[3]);
      const page = Number(parts[4] || 0);
      const removed = store.removeRule(interaction.guildId, id);
      const view = buildOverviewView(interaction.guildId, page);
      const content = removed ? `Removed rule #${id}.` : `Rule #${id} no longer exists.`;
      try { await interaction.update({ content, ...view }); } catch (_) {}
      return true;
    }

    if (action === 'edit') {
      const id = Number(parts[3]);
      const page = Number(parts[4] || 0);
      const rule = store.getRule(interaction.guildId, id);
      if (!rule) {
        const view = buildOverviewView(interaction.guildId, page);
        try { await interaction.update({ content: `Rule #${id} no longer exists.`, ...view }); } catch (_) {}
        return true;
      }

      try {
        await interaction.showModal(buildEditModal(rule, page));
      } catch (_) {
        try { await interaction.reply({ content: 'Could not open the edit form. Please try again.', ephemeral: true }); } catch (_) {}
      }
      return true;
    }

    return false;
  },

  async handleModalSubmit(interaction) {
    if (!interaction.inGuild()) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith(`${EDIT_MODAL_PREFIX}:`)) {
      return false;
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      try { await interaction.reply({ content: 'Only server administrators can configure autorespond.', ephemeral: true }); } catch (_) {}
      return true;
    }

    const parts = interaction.customId.split(':');
    const ruleId = Number(parts[3] || 0);
    const page = Number(parts[4] || 0);
    const existing = store.getRule(interaction.guildId, ruleId);
    if (!existing) {
      try { await interaction.reply({ content: `Rule #${ruleId} no longer exists.`, ephemeral: true }); } catch (_) {}
      return true;
    }

    const trigger = (interaction.fields.getTextInputValue(EDIT_FIELD_IDS.trigger) || '').trim();
    const reply = (interaction.fields.getTextInputValue(EDIT_FIELD_IDS.reply) || '').trim();
    const mediaUrl = (interaction.fields.getTextInputValue(EDIT_FIELD_IDS.mediaUrl) || '').trim();
    const stickerInput = (interaction.fields.getTextInputValue(EDIT_FIELD_IDS.sticker) || '').trim();
    const optionsRaw = (interaction.fields.getTextInputValue(EDIT_FIELD_IDS.options) || '').trim();

    if (!trigger) {
      try { await interaction.reply({ content: 'Trigger cannot be empty.', ephemeral: true }); } catch (_) {}
      return true;
    }

    let parsedMediaUrl = null;
    if (mediaUrl) {
      try { parsedMediaUrl = new URL(mediaUrl); } catch (_) {}
      if (!parsedMediaUrl || !['http:', 'https:'].includes(parsedMediaUrl.protocol)) {
        try { await interaction.reply({ content: 'The media URL must be a valid `http` or `https` URL.', ephemeral: true }); } catch (_) {}
        return true;
      }
    }

    const parsedOptions = parseEditOptions(optionsRaw);
    if (parsedOptions.error) {
      try { await interaction.reply({ content: parsedOptions.error, ephemeral: true }); } catch (_) {}
      return true;
    }

    const optionUpdates = parsedOptions.updates || {};
    const channelWasUpdated = Object.prototype.hasOwnProperty.call(optionUpdates, 'channelId');
    const targetChannelId = channelWasUpdated
      ? optionUpdates.channelId
      : existing.channelId;
    if (channelWasUpdated && targetChannelId) {
      let targetChannel = interaction.guild.channels.cache.get(targetChannelId) || null;
      if (!targetChannel) {
        try { targetChannel = await interaction.guild.channels.fetch(targetChannelId); } catch (_) {}
      }
      if (!targetChannel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(targetChannel.type)) {
        try { await interaction.reply({ content: 'Channel must be a valid text or announcement channel in this server.', ephemeral: true }); } catch (_) {}
        return true;
      }
    }

    let sticker = null;
    if (stickerInput) {
      sticker = await resolveGuildSticker(interaction.guild, stickerInput);
      if (!sticker) {
        try { await interaction.reply({ content: 'Could not find that server sticker. Use a sticker ID or exact sticker name from this server.', ephemeral: true }); } catch (_) {}
        return true;
      }
    }

    if (!reply && !mediaUrl && !sticker) {
      try { await interaction.reply({ content: 'Provide at least one response type: reply, media URL, or sticker.', ephemeral: true }); } catch (_) {}
      return true;
    }

    const existingMediaUrl = String(existing.mediaUrl || '').trim();
    const shouldRefreshStoredMedia = Boolean(mediaUrl) && (mediaUrl !== existingMediaUrl || !existing.mediaStoredPath);

    let preparedStoredMedia = null;
    if (shouldRefreshStoredMedia) {
      const fetchedMedia = await fetchMediaAttachment(mediaUrl);
      if (!fetchedMedia) {
        try {
          await interaction.reply({
            content: 'Could not download the new media URL, or the file type/size is not supported.',
            ephemeral: true,
          });
        } catch (_) {}
        return true;
      }
      try {
        preparedStoredMedia = await storeRuleMediaBuffer(
          interaction.guildId,
          ruleId,
          fetchedMedia.attachment,
          fetchedMedia.name,
        );
      } catch (_) {
        preparedStoredMedia = null;
      }
      if (!preparedStoredMedia) {
        try {
          await interaction.reply({
            content: 'Could not store media for that URL. Rule was not updated.',
            ephemeral: true,
          });
        } catch (_) {}
        return true;
      }
    }

    const updates = {
      trigger,
      reply,
      mediaUrl,
      stickerId: sticker?.id || '',
      match: Object.prototype.hasOwnProperty.call(optionUpdates, 'match') ? optionUpdates.match : existing.match,
      caseSensitive: Object.prototype.hasOwnProperty.call(optionUpdates, 'caseSensitive')
        ? optionUpdates.caseSensitive
        : existing.caseSensitive,
      channelId: targetChannelId || null,
    };

    if (preparedStoredMedia) {
      updates.mediaStoredPath = preparedStoredMedia.mediaStoredPath;
      updates.mediaStoredName = preparedStoredMedia.mediaStoredName;
    } else if (!mediaUrl) {
      updates.mediaStoredPath = '';
      updates.mediaStoredName = '';
    }

    const updated = store.updateRule(interaction.guildId, ruleId, updates);

    if (!updated) {
      if (preparedStoredMedia?.mediaStoredPath) {
        deleteStoredMediaSync(preparedStoredMedia.mediaStoredPath);
      }
      try { await interaction.reply({ content: `Rule #${ruleId} no longer exists.`, ephemeral: true }); } catch (_) {}
      return true;
    }

    const detail = buildRuleDetailView(interaction.guildId, ruleId, page);
    try {
      await interaction.reply({
        content: `Updated rule #${ruleId}.`,
        ...detail,
        ephemeral: true,
      });
    } catch (_) {}
    return true;
  },
};

export {};


