const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const logChannelTypeStore = require('./logChannelTypeStore');
const { applyDefaultColour } = require('./guildColourStore');
const { getLogKeyLabel, getFallbackKey } = require('./logEvents');
const { isMysqlConfigured } = require('./mysqlPool');

const DEFAULT_COLOR = 0x5865f2;
const ROUTE_LABEL_OVERRIDES = Object.freeze({
  message_create: 'Creations',
  message_edit: 'Edits',
  message_delete: 'Deletes',
  member_join: 'Joins',
  member_leave: 'Leaves',
  member_boost: 'Boosts',
  invite_create: 'Invite Creations',
  invite_delete: 'Invite Deletions',
  invite_used: 'Invite Uses',
  rupee_spend: 'Rupee Spending',
  security: 'Antinuke Alerts',
});
const LOG_GROUPS = Object.freeze([
  {
    id: 'message',
    label: 'Message Events',
    keys: ['message_create', 'message_edit', 'message_delete'],
  },
  {
    id: 'user',
    label: 'User Events',
    keys: ['member_join', 'member_leave', 'member_boost'],
  },
  {
    id: 'invites',
    label: 'Invites',
    keys: ['invite_create', 'invite_delete', 'invite_used'],
  },
  {
    id: 'rupee',
    label: 'Rupee Events',
    keys: ['rupee_spend'],
  },
  {
    id: 'antinuke',
    label: 'Antinuke Events',
    keys: ['security'],
  },
]);

function getEntry(entries, key) {
  return entries?.[key] || { channelId: null, enabled: true };
}

function getRouteLabel(key) {
  return ROUTE_LABEL_OVERRIDES[key] || getLogKeyLabel(key);
}

function getGroupById(groupId) {
  if (!groupId) return LOG_GROUPS[0];
  return LOG_GROUPS.find(group => group.id === groupId) || LOG_GROUPS[0];
}

function getGroupForKey(logKey) {
  if (!logKey) return null;
  return LOG_GROUPS.find(group => group.keys.includes(logKey)) || null;
}

function isRouteEnabled(entry) {
  return entry?.enabled !== false;
}

function resolveRouteChannel(entries, key, entry) {
  if (entry?.channelId) return { channelId: entry.channelId, fallback: false };
  const fallbackKey = getFallbackKey(key);
  if (!fallbackKey) return { channelId: null, fallback: false };
  const fallbackEntry = getEntry(entries, fallbackKey);
  if (!isRouteEnabled(fallbackEntry) || !fallbackEntry?.channelId) {
    return { channelId: null, fallback: false };
  }
  return { channelId: fallbackEntry.channelId, fallback: true };
}

function isRouteOn(entries, key, entry) {
  if (!isRouteEnabled(entry)) return false;
  return Boolean(resolveRouteChannel(entries, key, entry).channelId);
}

function getGroupStatus(entries, group) {
  const hasActiveRoute = group.keys.some(key => {
    const entry = getEntry(entries, key);
    return isRouteOn(entries, key, entry);
  });
  return hasActiveRoute ? '✅ On' : '❌ Off';
}

function formatRouteEntry(entries, key, entry) {
  const routeState = isRouteOn(entries, key, entry) ? '✅ On' : '❌ Off';
  const resolved = resolveRouteChannel(entries, key, entry);
  const channelDisplay = resolved.channelId
    ? `<#${resolved.channelId}>${resolved.fallback ? ' (fallback)' : ''}`
    : 'Not configured';
  return `${routeState}\nChannel: ${channelDisplay}`;
}

async function buildLogConfigView(guild, selectedKey, options = {}) {
  const guildId = guild?.id;
  const entries = guildId ? await logChannelTypeStore.getAll(guildId) : {};

  const selectedGroupFromOption = options.category ? getGroupById(options.category) : null;
  const selectedGroupFromKey = getGroupForKey(selectedKey);
  const activeGroup = selectedGroupFromOption || selectedGroupFromKey || LOG_GROUPS[0];
  const selected = (selectedKey && activeGroup.keys.includes(selectedKey))
    ? selectedKey
    : activeGroup.keys[0];
  const selectedEntry = selected ? getEntry(entries, selected) : null;

  const descriptionParts = [
    'Select a logging group, then pick an event route and assign the channel where logs should be sent.',
    'Use the toggle button to enable or disable the selected route.',
    `Storage: **${isMysqlConfigured() ? 'MySQL' : 'Local JSON'}**`,
  ];
  if (options.note) descriptionParts.push(options.note);

  const embed = new EmbedBuilder()
    .setTitle('Log configuration')
    .setDescription(descriptionParts.join('\n'))
    .setColor(DEFAULT_COLOR)
    .setTimestamp(new Date());

  embed.addFields({
    name: 'Logging Groups',
    value: LOG_GROUPS.map(group => `• **${group.label}:** ${getGroupStatus(entries, group)}`).join('\n'),
    inline: false,
  });

  embed.addFields({
    name: `${activeGroup.label} Routes`,
    value: activeGroup.keys.map(key => {
      const entry = getEntry(entries, key);
      return `• **${getRouteLabel(key)}:** ${formatRouteEntry(entries, key, entry)}`;
    }).join('\n'),
    inline: false,
  });

  if (selected && selectedEntry) {
    embed.addFields({
      name: `Selected: ${getRouteLabel(selected)}`,
      value: formatRouteEntry(entries, selected, selectedEntry),
      inline: false,
    });
  }

  try {
    applyDefaultColour(embed, guildId);
  } catch (_) {}

  const groupSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logconfig:category')
      .setPlaceholder('Select an event to configure logging')
      .addOptions(LOG_GROUPS.map(group => ({
        label: group.label,
        value: group.id,
        default: group.id === activeGroup.id,
      })))
  );

  const eventSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`logconfig:event:${activeGroup.id}:0`)
      .setPlaceholder('Select a route in this logging event')
      .addOptions(activeGroup.keys.map(key => ({
        label: getRouteLabel(key).slice(0, 100),
        value: key,
        default: key === selected,
      })))
      .setDisabled(!activeGroup.keys.length)
  );

  const toggleButton = new ButtonBuilder()
    .setCustomId(`logconfig:toggle:${selected ?? 'none'}`)
    .setLabel(selected ? (selectedEntry?.enabled ? 'Disable' : 'Enable') : 'Select an event')
    .setStyle(selectedEntry?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setDisabled(!selected);

  const buttonRow = new ActionRowBuilder().addComponents(toggleButton);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`logconfig:setchannel:${selected ?? 'none'}`)
    .setPlaceholder(selected ? `Choose channel for ${getRouteLabel(selected)}` : 'Select an event first')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!selected);

  const channelRow = new ActionRowBuilder().addComponents(channelSelect);

  const components = [groupSelectRow, eventSelectRow, buttonRow, channelRow];

  return {
    embed,
    components,
    selectedKey: selected,
    category: activeGroup.id,
    page: 0,
  };
}

module.exports = { buildLogConfigView };
