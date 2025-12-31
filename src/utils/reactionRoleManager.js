const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

const MAX_OPTIONS = 25;

function normaliseRows(rows) {
  return (rows || []).map(row => (typeof row.toJSON === 'function' ? row.toJSON() : row));
}

function rowHasCustomId(row, customId) {
  const components = Array.isArray(row?.components) ? row.components : [];
  return components.some(component => {
    const id = component?.custom_id || component?.customId;
    return id === customId;
  });
}

function buildRoleOptions(guild, roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  const options = [];
  const missing = [];
  for (const id of ids.slice(0, MAX_OPTIONS)) {
    const role = guild?.roles?.cache?.get(id) || null;
    if (!role) {
      missing.push(id);
      continue;
    }
    const count = Number.isInteger(role.members?.size) ? role.members.size : 0;
    options.push({
      label: role.name.slice(0, 100),
      value: id,
      description: `${count} member${count === 1 ? '' : 's'}`,
    });
  }
  return { options, missing };
}

function buildMenuRow(panel, guild) {
  const customId = `rr:select:${panel.id}`;
  const { options, missing } = buildRoleOptions(guild, panel.roleIds);
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
};
