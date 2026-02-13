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

const DEFAULT_COLOR = 0x5865f2;
const ROUTE_LABEL_OVERRIDES = Object.freeze({
  member_timeout: 'User Muted',
  member_untimeout: 'User Unmuted',
});
const LOG_GROUPS = Object.freeze([
  {
    id: 'message',
    label: 'Message Events',
    keys: ['message_create', 'message_edit', 'message_delete', 'messages_purged'],
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
    id: 'mod_actions',
    label: 'Mod Actions',
    keys: [
      'member_ban',
      'member_unban',
      'member_kick',
      'member_timeout',
      'member_untimeout',
    ],
  },
  {
    id: 'emoji_stickers',
    label: 'Emoji and Stickers',
    keys: ['emoji_sticker_add', 'emoji_sticker_delete', 'emoji_sticker_edit'],
  },
  {
    id: 'rupee',
    label: 'Rupee Events',
    keys: ['rupee_spend'],
  },
  {
    id: 'antinuke',
    label: 'Security Events',
    keys: ['security', 'restraining_order_violation'],
  },
]);

const OVERVIEW_DESCRIPTION = [
  'Below is the current status of the logging events.',
  'To configure or edit the current setup, select the event in the selection menu underneath this embed.',
].join('\n');

const DETAIL_DESCRIPTION = 'To configure the logging events, use the select menu under the embed.';

function getEntry(entries, key) {
  return entries?.[key] || { channelId: null, enabled: true };
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

function getGroupConfiguredCount(entries, group) {
  return group.keys.reduce((count, key) => {
    const entry = getEntry(entries, key);
    return count + (isRouteOn(entries, key, entry) ? 1 : 0);
  }, 0);
}

function formatRouteEntry(entries, key) {
  const entry = getEntry(entries, key);
  const routeState = isRouteOn(entries, key, entry) ? '✅' : '❌';
  const resolved = resolveRouteChannel(entries, key, entry);
  const channelDisplay = resolved.channelId
    ? `<#${resolved.channelId}>${resolved.fallback ? ' (fallback)' : ''}${entry?.enabled === false ? ' (Disabled)' : ''}`
    : 'Not configured';
  const displayLabel = ROUTE_LABEL_OVERRIDES[key] || getLogKeyLabel(key);
  return `${displayLabel} (${routeState}) - ${channelDisplay}`;
}

function formatGroupSummary(entries, group) {
  const configured = getGroupConfiguredCount(entries, group);
  const total = group.keys.length;
  const groupOn = configured === total && total > 0;
  return `• **${group.label} (${configured}/${total})** ${groupOn ? '✅ ON' : '❌ OFF'}`;
}

async function buildLogConfigView(guild, selectedKey, options = {}) {
  const guildId = guild?.id;
  const entries = guildId ? await logChannelTypeStore.getAll(guildId) : {};

  const selectedGroupFromOption = options.category ? getGroupById(options.category) : null;
  const selectedGroupFromKey = getGroupForKey(selectedKey);
  const activeGroup = selectedGroupFromOption || selectedGroupFromKey || LOG_GROUPS[0];
  const showOverviewOnly = !selectedGroupFromOption && !selectedGroupFromKey && !selectedKey;
  const selected = (selectedKey && activeGroup.keys.includes(selectedKey))
    ? selectedKey
    : (showOverviewOnly ? null : activeGroup.keys[0]);
  const selectedEntry = selected ? getEntry(entries, selected) : null;

  const embed = new EmbedBuilder()
    .setTitle('Log Configuration')
    .setDescription(showOverviewOnly ? OVERVIEW_DESCRIPTION : DETAIL_DESCRIPTION)
    .setColor(DEFAULT_COLOR)
    .setTimestamp(new Date());

  if (showOverviewOnly) {
    embed.addFields({
      name: 'Log Event Groups:',
      value: LOG_GROUPS.map(group => formatGroupSummary(entries, group)).join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: `${activeGroup.label}:`,
      value: activeGroup.keys.map(key => formatRouteEntry(entries, key)).join('\n'),
      inline: false,
    });
  }

  try {
    applyDefaultColour(embed, guildId);
  } catch (_) {}

  const groupSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logconfig:category')
      .setPlaceholder('Select a logging event group')
      .addOptions(LOG_GROUPS.map(group => ({
        label: group.label,
        value: group.id,
        default: !showOverviewOnly && group.id === activeGroup.id,
      })))
  );

  const components = [groupSelectRow];

  if (!showOverviewOnly) {
    const eventSelectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`logconfig:event:${activeGroup.id}`)
        .setPlaceholder(`Select an event in ${activeGroup.label}`)
        .addOptions(activeGroup.keys.map(key => ({
          label: getLogKeyLabel(key).slice(0, 100),
          value: key,
          default: key === selected,
        })))
        .setDisabled(!activeGroup.keys.length)
    );

    const toggleButton = new ButtonBuilder()
      .setCustomId(`logconfig:toggle:${selected ?? 'none'}`)
      .setLabel(selected ? (selectedEntry?.enabled ? 'Disable Event' : 'Enable Event') : 'Select an event')
      .setStyle(selectedEntry?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!selected);

    const buttonRow = new ActionRowBuilder().addComponents(toggleButton);

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`logconfig:setchannel:${selected ?? 'none'}`)
      .setPlaceholder(selected ? `Choose channel for ${getLogKeyLabel(selected)}` : 'Select an event first')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(!selected);

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);
    components.push(eventSelectRow, buttonRow, channelRow);
  }

  return {
    embed,
    components,
    selectedKey: selected,
    category: activeGroup.id,
    page: 0,
  };
}

module.exports = { buildLogConfigView };
