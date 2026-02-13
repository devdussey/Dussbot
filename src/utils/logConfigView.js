const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const logChannelTypeStore = require('./logChannelTypeStore');
const { applyDefaultColour } = require('./guildColourStore');
const { getLogKeyLabel, getFallbackKey } = require('./logEvents');

const DEFAULT_COLOR = 0x5865f2;
const OVERVIEW_GROUP_ID = 'overview';

const ROUTE_LABEL_OVERRIDES = Object.freeze({
  member_timeout: 'User Muted',
  member_untimeout: 'User Unmuted',
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
    id: 'mod_actions',
    label: 'Mod Actions',
    keys: ['member_ban', 'member_unban', 'member_kick', 'member_timeout', 'member_untimeout'],
  },
  {
    id: 'emoji_stickers',
    label: 'Emoji and Stickers',
    keys: ['emoji_sticker_add', 'emoji_sticker_delete', 'emoji_sticker_edit'],
  },
  {
    id: 'rupee',
    label: 'Rupee Events',
    keys: ['rupee_spend', 'rupee_earned', 'rupee_given'],
  },
  {
    id: 'security',
    label: 'Security Events',
    keys: ['antinuke_enabled', 'antinuke_disabled', 'antinuke_edited', 'antinuke_triggered', 'messages_purged'],
  },
  {
    id: 'bots_integrations',
    label: 'Bots and Integrations',
    keys: ['bot_join', 'bot_action', 'webhook_create', 'webhook_delete'],
  },
  {
    id: 'server',
    label: 'Server',
    keys: [
      'server',
      'role_create',
      'role_update',
      'role_delete',
      'channel_create',
      'channel_update',
      'channel_delete',
      'category_create',
      'category_update',
      'category_delete',
    ],
  },
]);

const OVERVIEW_DESCRIPTION = [
  'Below is the current status of logging event groups.',
  'Choose a group from the menu to configure single events, or set one channel for that whole group.',
].join('\n');

const DETAIL_DESCRIPTION = [
  'Select an event to set its channel.',
  'You can also set one channel for all events in this group.',
].join('\n');

function getEntry(entries, key) {
  return entries?.[key] || { channelId: null, enabled: true };
}

function getLogGroupById(groupId) {
  if (!groupId || groupId === OVERVIEW_GROUP_ID) return null;
  return LOG_GROUPS.find(group => group.id === groupId) || null;
}

function getGroupForKey(logKey) {
  if (!logKey) return null;
  return LOG_GROUPS.find(group => group.keys.includes(logKey)) || null;
}

function isRouteEnabled(entry) {
  return entry?.enabled !== false;
}

function isChannelUsable(channel) {
  if (!channel) return false;
  if (channel.type === ChannelType.GuildForum) return true;
  return Boolean(channel.isTextBased?.());
}

function hasRoutePermissions(guild, channel) {
  if (!guild || !channel) return false;
  const me = guild.members?.me;
  if (!me || !channel.permissionsFor) return true;
  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  if (channel.type === ChannelType.GuildForum) {
    return perms.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.SendMessagesInThreads,
    ]);
  }
  if (channel.isThread?.()) {
    return perms.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.SendMessagesInThreads,
    ]);
  }
  return perms.has([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.SendMessages,
  ]);
}

async function buildChannelStateMap(guild, entries) {
  const state = new Map();
  if (!guild || !entries || typeof entries !== 'object') return state;
  const ids = new Set(
    Object.values(entries)
      .map(entry => entry?.channelId)
      .filter(Boolean),
  );

  await Promise.all(Array.from(ids).map(async (id) => {
    const channelId = String(id);
    let channel = guild.channels?.cache?.get(channelId) || null;
    if (!channel) {
      try {
        channel = await guild.channels.fetch(channelId);
      } catch (_) {
        channel = null;
      }
    }
    state.set(channelId, {
      exists: Boolean(channel),
      usable: isChannelUsable(channel) && hasRoutePermissions(guild, channel),
    });
  }));

  return state;
}

function resolveRouteChannel(entries, key, entry, channelStateMap) {
  if (entry?.channelId) {
    const channelId = String(entry.channelId);
    const channelState = channelStateMap.get(channelId) || { exists: false, usable: false };
    return { channelId, fallback: false, usable: channelState.usable };
  }
  const fallbackKey = getFallbackKey(key);
  if (!fallbackKey) return { channelId: null, fallback: false, usable: false };
  const fallbackEntry = getEntry(entries, fallbackKey);
  if (!isRouteEnabled(fallbackEntry) || !fallbackEntry?.channelId) {
    return { channelId: null, fallback: false, usable: false };
  }
  const fallbackChannelId = String(fallbackEntry.channelId);
  const channelState = channelStateMap.get(fallbackChannelId) || { exists: false, usable: false };
  return { channelId: fallbackChannelId, fallback: true, usable: channelState.usable };
}

function isRouteOn(entries, key, entry, channelStateMap) {
  if (!isRouteEnabled(entry)) return false;
  const resolved = resolveRouteChannel(entries, key, entry, channelStateMap);
  return Boolean(resolved.channelId && resolved.usable);
}

function getGroupConfiguredCount(entries, group, channelStateMap) {
  return group.keys.reduce((count, key) => {
    const entry = getEntry(entries, key);
    return count + (isRouteOn(entries, key, entry, channelStateMap) ? 1 : 0);
  }, 0);
}

function formatRouteEntry(entries, key, channelStateMap) {
  const entry = getEntry(entries, key);
  const routeOn = isRouteOn(entries, key, entry, channelStateMap);
  const routeState = routeOn ? '✅' : '❌';
  const resolved = resolveRouteChannel(entries, key, entry, channelStateMap);
  const channelDisplay = (resolved.channelId && resolved.usable)
    ? `<#${resolved.channelId}>${resolved.fallback ? ' (fallback)' : ''}${entry?.enabled === false ? ' (Disabled)' : ''}`
    : 'X';
  const displayLabel = ROUTE_LABEL_OVERRIDES[key] || getLogKeyLabel(key);
  return `${displayLabel} (${routeState}) - ${channelDisplay}`;
}

function formatGroupSummary(entries, group, channelStateMap) {
  const configured = getGroupConfiguredCount(entries, group, channelStateMap);
  const total = group.keys.length;
  const groupOn = configured === total && total > 0;
  return `• **${group.label} (${configured}/${total})** ${groupOn ? '✅ ON' : '❌ OFF'}`;
}

function buildGroupSelectOptions(activeGroup, showOverviewOnly) {
  const options = [
    {
      label: 'Overview',
      value: OVERVIEW_GROUP_ID,
      default: showOverviewOnly,
    },
    ...LOG_GROUPS.map(group => ({
      label: group.label,
      value: group.id,
      default: !showOverviewOnly && activeGroup?.id === group.id,
    })),
  ];
  return options;
}

async function buildLogConfigView(guild, selectedKey, options = {}) {
  const guildId = guild?.id;
  const entries = guildId ? await logChannelTypeStore.getAll(guildId) : {};
  const channelStateMap = await buildChannelStateMap(guild, entries);

  const requestedCategory = String(options.category || '').trim() || null;
  const selectedGroupFromOption = getLogGroupById(requestedCategory);
  const selectedGroupFromKey = getGroupForKey(selectedKey);

  const showOverviewOnly = requestedCategory === OVERVIEW_GROUP_ID
    || (!selectedGroupFromOption && !selectedGroupFromKey && !selectedKey && !requestedCategory);

  const activeGroup = showOverviewOnly
    ? null
    : (selectedGroupFromOption || selectedGroupFromKey || LOG_GROUPS[0]);

  const selected = (!showOverviewOnly && selectedKey && activeGroup.keys.includes(selectedKey))
    ? selectedKey
    : (!showOverviewOnly ? activeGroup.keys[0] : null);
  const selectedEntry = selected ? getEntry(entries, selected) : null;

  const embed = new EmbedBuilder()
    .setTitle(showOverviewOnly ? 'Overview' : activeGroup.label)
    .setDescription(showOverviewOnly ? OVERVIEW_DESCRIPTION : DETAIL_DESCRIPTION)
    .setColor(DEFAULT_COLOR)
    .setTimestamp(new Date());

  if (showOverviewOnly) {
    embed.addFields({
      name: 'Log Event Groups',
      value: LOG_GROUPS.map(group => formatGroupSummary(entries, group, channelStateMap)).join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: `${activeGroup.label}`,
      value: activeGroup.keys.map(key => formatRouteEntry(entries, key, channelStateMap)).join('\n'),
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
      .addOptions(buildGroupSelectOptions(activeGroup, showOverviewOnly)),
  );

  const components = [groupSelectRow];

  if (!showOverviewOnly) {
    const groupChannelRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`logconfig:setgroupchannel:${activeGroup.id}`)
        .setPlaceholder(`Set one channel for all ${activeGroup.label}`)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(!activeGroup.keys.length),
    );

    const eventSelectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`logconfig:event:${activeGroup.id}`)
        .setPlaceholder(`Select an event in ${activeGroup.label}`)
        .addOptions(activeGroup.keys.map(key => ({
          label: getLogKeyLabel(key).slice(0, 100),
          value: key,
          default: key === selected,
        })))
        .setDisabled(!activeGroup.keys.length),
    );

    const selectedResolved = selected
      ? resolveRouteChannel(entries, selected, selectedEntry, channelStateMap)
      : { channelId: null, usable: false };
    const selectedRouteOn = selected ? isRouteOn(entries, selected, selectedEntry, channelStateMap) : false;
    const canToggleSelected = Boolean(selected && selectedResolved.channelId && selectedResolved.usable);
    const nextEnabled = selectedRouteOn ? '0' : '1';

    const toggleButton = new ButtonBuilder()
      .setCustomId(`logconfig:setenabled:${selected ?? 'none'}:${nextEnabled}`)
      .setLabel(
        selected
          ? (canToggleSelected ? (selectedRouteOn ? 'Disable Event' : 'Enable Event') : 'Set valid channel first')
          : 'Select an event',
      )
      .setStyle(
        !canToggleSelected
          ? ButtonStyle.Secondary
          : (selectedRouteOn ? ButtonStyle.Danger : ButtonStyle.Success),
      )
      .setDisabled(!canToggleSelected);

    const buttonRow = new ActionRowBuilder().addComponents(toggleButton);

    const eventChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`logconfig:setchannel:${selected ?? 'none'}`)
      .setPlaceholder(selected ? `Choose channel for ${getLogKeyLabel(selected)}` : 'Select an event first')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(!selected);

    const eventChannelRow = new ActionRowBuilder().addComponents(eventChannelSelect);
    components.push(groupChannelRow, eventSelectRow, buttonRow, eventChannelRow);
  }

  return {
    embed,
    components,
    selectedKey: selected,
    category: showOverviewOnly ? OVERVIEW_GROUP_ID : activeGroup.id,
    page: 0,
  };
}

module.exports = {
  buildLogConfigView,
  LOG_GROUPS,
  OVERVIEW_GROUP_ID,
  getLogGroupById,
};
