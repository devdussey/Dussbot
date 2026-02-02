const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { applyDefaultColour } = require('./guildColourStore');

const MAX_OPTIONS = 25;
const SUMMARY_FOOTER_PREFIX = 'Reaction Roles - Panel #';

function normaliseRows(rows) {
  return (rows || []).map(row => (typeof row.toJSON === 'function' ? row.toJSON() : row));
}

function normaliseEmbeds(embeds) {
  return (embeds || [])
    .map(embed => (typeof embed?.toJSON === 'function' ? embed.toJSON() : embed))
    .filter(Boolean);
}

function hasMeaningfulText(embed) {
  if (!embed) return false;
  if (embed.title || embed.description) return true;
  if (Array.isArray(embed.fields) && embed.fields.length) return true;
  if (embed.footer?.text) return true;
  if (embed.author?.name) return true;
  return false;
}

function rowHasCustomId(row, customId) {
  const components = Array.isArray(row?.components) ? row.components : [];
  return components.some(component => {
    const id = component?.custom_id || component?.customId;
    return id === customId;
  });
}

function formatEmojiForEmbed(emoji) {
  if (!emoji) return null;
  if (typeof emoji === 'string') return emoji;
  if (typeof emoji === 'object') {
    const name = emoji.name || 'emoji';
    if (emoji.id) {
      const prefix = emoji.animated ? '<a:' : '<:';
      return `${prefix}${name}:${emoji.id}>`;
    }
    return name;
  }
  return null;
}

function getRoleCount(role) {
  if (!role) return 0;
  if (Number.isInteger(role.memberCount)) return role.memberCount;
  if (role.members && Number.isInteger(role.members.size)) return role.members.size;
  return 0;
}

function buildRoleOptions(guild, panel) {
  const ids = Array.isArray(panel?.roleIds) ? panel.roleIds : [];
  const emojiMap = panel?.emojis && typeof panel.emojis === 'object' ? panel.emojis : {};
  const options = [];
  const missing = [];
  for (const id of ids.slice(0, MAX_OPTIONS)) {
    const role = guild?.roles?.cache?.get(id) || null;
    if (!role) {
      missing.push(id);
      continue;
    }
    const count = getRoleCount(role);
    const option = {
      label: role.name.slice(0, 100),
      value: id,
      description: `${count} member${count === 1 ? '' : 's'}`,
    };
    if (Object.prototype.hasOwnProperty.call(emojiMap, id)) {
      const emoji = emojiMap[id];
      if (emoji) option.emoji = emoji;
    }
    options.push(option);
  }
  return { options, missing };
}

function buildMenuRow(panel, guild) {
  const customId = `rr:select:${panel.id}`;
  const { options, missing } = buildRoleOptions(guild, panel);
  let finalOptions = options;
  let disabled = false;
  if (!finalOptions.length) {
    finalOptions = [{ label: 'No roles available', value: 'none' }];
    disabled = true;
  }

  const maxValues = panel.multi ? Math.min(finalOptions.length, MAX_OPTIONS) : 1;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(panel.multi ? 'Select roles to toggle' : 'Select a role')
    .setMinValues(0)
    .setMaxValues(maxValues)
    .setDisabled(disabled)
    .addOptions(finalOptions);

  return {
    customId,
    row: new ActionRowBuilder().addComponents(menu),
    missingRoleIds: missing,
  };
}

function buildSummaryEmbed(panel, guild, opts = {}) {
  const ids = Array.isArray(panel?.roleIds) ? panel.roleIds : [];
  const emojiMap = panel?.emojis && typeof panel.emojis === 'object' ? panel.emojis : {};
  const highlightIds = new Set(Array.isArray(opts.highlightRoleIds) ? opts.highlightRoleIds : []);
  const lines = [];
  const missing = [];
  let totalMembers = 0;
  const roleData = [];

  for (const id of ids.slice(0, MAX_OPTIONS)) {
    const role = guild?.roles?.cache?.get(id) || null;
    if (!role) {
      missing.push(id);
      lines.push(`- Role deleted (ID ${id})`);
      continue;
    }
    const count = getRoleCount(role);
    totalMembers += count;
    roleData.push({ role, count, emoji: formatEmojiForEmbed(emojiMap[id]) });
  }

  for (const entry of roleData) {
    const { role, count, emoji } = entry;
    const selectionSuffix = highlightIds.has(role.id) ? ' (you have this)' : '';
    const percent = totalMembers > 0 ? Math.round((count / totalMembers) * 100) : 0;
    const emojiPart = emoji ? `${emoji} ` : '';
    const plural = count === 1 ? 'Member' : 'Members';
    lines.push(`${emojiPart}<@&${role.id}> - ${count} ${plural} (${percent}%)${selectionSuffix}`);
  }

  if (!lines.length) lines.push('No roles configured yet.');

  const embed = new EmbedBuilder().setDescription(lines.join('\n'));
  if (opts.title) embed.setTitle(opts.title);
  const footerText = `${SUMMARY_FOOTER_PREFIX}${panel?.id || 'unknown'}`;
  embed.setFooter({ text: footerText });

  try { applyDefaultColour(embed, guild?.id); } catch (_) {}

  return { embed, missingRoleIds: missing };
}

function isSummaryEmbed(embed, panelId, roleIds) {
  const footerText = (embed?.footer?.text || '');
  if (footerText.includes(SUMMARY_FOOTER_PREFIX)) return true;
  const desc = typeof embed?.description === 'string' ? embed.description : '';
  if (!desc) return false;
  if (desc.includes('Role deleted (ID')) return true;
  if (desc.includes('No roles configured yet.')) return true;
  if (Array.isArray(roleIds)) {
    for (const id of roleIds) {
      if (desc.includes(`<@&${id}>`)) return true;
    }
  }
  return false;
}

function mergeSummaryEmbed(existingEmbeds, summaryEmbed, panel, opts = {}) {
  const embeds = normaliseEmbeds(existingEmbeds);
  const summaryJson = typeof summaryEmbed?.toJSON === 'function' ? summaryEmbed.toJSON() : summaryEmbed;
  if (!summaryJson) return { ok: false, error: 'invalid_summary', embeds };
  const panelId = panel?.id || panel;
  const roleIds = Array.isArray(panel?.roleIds) ? panel.roleIds : [];
  const filtered = embeds.filter(e => !isSummaryEmbed(e, panelId, roleIds));
  if (filtered.length === embeds.length && embeds.length >= 10) {
    return { ok: false, error: 'max_embeds', embeds };
  }
  const next = [...filtered, summaryJson];
  const replaced = filtered.length !== embeds.length;
  return { ok: true, embeds: next, replaced, inserted: !replaced };
}

function removeSummaryEmbed(existingEmbeds, panelId) {
  const embeds = normaliseEmbeds(existingEmbeds);
  const footerText = `${SUMMARY_FOOTER_PREFIX}${panelId}`;
  const filtered = embeds.filter(e => (e?.footer?.text || '') !== footerText);
  return { embeds: filtered, removed: filtered.length !== embeds.length };
}

function upsertMenuRow(existingRows, customId, menuRow) {
  const rows = normaliseRows(existingRows);
  const nextRow = typeof menuRow?.toJSON === 'function' ? menuRow.toJSON() : menuRow;
  let replaced = false;
  const updated = rows.map(row => {
    if (rowHasCustomId(row, customId)) {
      replaced = true;
      return nextRow;
    }
    return row;
  });

  if (!replaced) {
    if (updated.length >= 5) {
      return { ok: false, error: 'max_rows', rows: updated };
    }
    updated.push(nextRow);
  }

  return { ok: true, rows: updated, replaced };
}

function removeMenuRow(existingRows, customId) {
  const rows = normaliseRows(existingRows);
  const filtered = rows.filter(row => !rowHasCustomId(row, customId));
  return { rows: filtered, removed: filtered.length !== rows.length };
}

module.exports = {
  buildMenuRow,
  upsertMenuRow,
  removeMenuRow,
  buildSummaryEmbed,
  mergeSummaryEmbed,
  removeSummaryEmbed,
};
