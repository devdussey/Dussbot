const {
  Events,
  EmbedBuilder,
  AuditLogEvent,
  PermissionsBitField,
  ChannelType,
  OverwriteType,
} = require('discord.js');
const logSender = require('../utils/logSender');
const inviteTracker = require('../utils/inviteTracker');
const { buildLogEmbed } = require('../utils/logEmbedFactory');

const INVITE_LOG_COLOR = 0x00f0ff;
const EVENT_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});
const WEBHOOK_AUDIT_CACHE = new Map();
const INTEGRATION_AUDIT_CACHE = new Map();
const INTEGRATION_FALLBACK_CACHE = new Map();
const AUDIT_EVENT_WINDOW_MS = 20_000;
const AUDIT_CACHE_TTL_MS = 5 * 60 * 1000;
const AUDIT_CACHE_MAX_SIZE = 1000;
const INTEGRATION_FALLBACK_THROTTLE_MS = 5_000;
const INTEGRATION_DEBUG_ENABLED = /^(1|true|yes|on)$/i
  .test(String(process.env.LOG_INTEGRATION_DEBUG || '').trim());

function debugIntegration(guild, message, details = null) {
  if (!INTEGRATION_DEBUG_ENABLED) return;
  const guildLabel = guild?.id || 'unknown-guild';
  const prefix = `[logDispatcher][integration][${guildLabel}] ${message}`;
  if (details && typeof details === 'object') {
    console.info(prefix, details);
    return;
  }
  console.info(prefix);
}

function formatUserTag(user, fallback = 'Unknown') {
  if (!user) return fallback;
  if (typeof user === 'string') return user;
  const tag = user.tag || user.username || user.globalName || 'Unknown';
  const id = user.id || 'unknown';
  return `${tag} (${id})`;
}

async function safeLog(guild, type, embed) {
  if (!guild) return;
  try {
    await logSender.sendLog({ guildId: guild.id, logType: type, embed, client: guild.client });
  } catch (err) {
    console.error(`Failed to send ${type} log for ${guild.id}:`, err);
  }
}

function formatAuditActor(user) {
  if (!user) return 'Unknown';
  return user.tag || user.username || user.globalName || user.id || 'Unknown';
}

function formatEventTime(date) {
  const d = date instanceof Date ? date : new Date();
  try {
    return EVENT_TIME_FORMATTER.format(d);
  } catch (_) {
    return d.toISOString();
  }
}

function resolveEmojiStickerThumbnail(item) {
  if (!item) return null;
  if (typeof item.imageURL === 'function') {
    return item.imageURL({
      extension: item.animated ? 'gif' : 'png',
      size: 256,
    });
  }
  if (typeof item.url === 'string' && item.url) return item.url;
  return null;
}

async function findRecentAuditEntry(guild, type, targetId) {
  if (!guild || !type) return null;
  let me = guild.members.me;
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch (_) { me = null; }
  }
  if (!me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const now = Date.now();
    return logs.entries.find(entry => {
      if (targetId && entry?.target?.id && String(entry.target.id) !== String(targetId)) return false;
      if (!entry?.createdTimestamp) return false;
      return (now - entry.createdTimestamp) <= AUDIT_EVENT_WINDOW_MS;
    }) || null;
  } catch (_) {
    return null;
  }
}

async function buildEmojiStickerAuditEmbed({ guild, eventLabel, itemType, item, auditType, color, details }) {
  const auditEntry = await findRecentAuditEntry(guild, auditType, item?.id);
  const actor = auditEntry?.executor || null;
  const eventDate = auditEntry?.createdAt instanceof Date ? auditEntry.createdAt : new Date();

  const embed = new EmbedBuilder()
    .setTitle(eventLabel)
    .setColor(color)
    .addFields(
      {
        name: `${itemType} Name`,
        value: `${item?.name || 'Unknown'} (${item?.id || 'unknown'})`,
        inline: false,
      },
      {
        name: 'Event done by',
        value: formatAuditActor(actor),
        inline: false,
      },
    )
    .setFooter({ text: `Event time: ${formatEventTime(eventDate)}` })
    .setTimestamp(eventDate);

  const thumbnail = resolveEmojiStickerThumbnail(item);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (details) {
    embed.addFields({
      name: 'Details',
      value: String(details).slice(0, 1024),
      inline: false,
    });
  }
  return embed;
}

function niceColor(color) {
  if (!color && color !== 0) return 'Default';
  return `#${color.toString(16).padStart(6, '0')}`;
}

function describeChannel(channel) {
  if (!channel) return 'Unknown channel';
  const parent = channel.parentId ? `<#${channel.parentId}>` : 'No category';
  return `${channel.isThread ? 'Thread' : channel.type} ${channel.name} (${channel.id}) - ${parent}`;
}

function isCategory(channel) {
  return channel?.type === ChannelType.GuildCategory;
}

function formatChannelType(channel) {
  if (isCategory(channel)) return 'Category';
  if (channel?.isThread?.()) return 'Thread';
  return String(channel?.type ?? 'Unknown');
}

function formatViewableRoles(channel, max = 12) {
  if (!channel?.permissionOverwrites?.cache) return 'Default (@everyone)';
  const roles = [];
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (!overwrite) continue;
    if (overwrite.type !== OverwriteType.Role && overwrite.type !== 0) continue;
    if (!overwrite.allow?.has(PermissionsBitField.Flags.ViewChannel)) continue;
    roles.push(`<@&${overwrite.id}>`);
  }
  if (!roles.length) return 'Default (@everyone)';
  const shown = roles.slice(0, max);
  if (roles.length > max) shown.push(`+${roles.length - max} more`);
  return shown.join(', ');
}

function diffRolePermissions(oldRole, newRole) {
  const oldPerms = new Set(oldRole?.permissions?.toArray?.() || []);
  const newPerms = new Set(newRole?.permissions?.toArray?.() || []);
  const added = [...newPerms].filter(value => !oldPerms.has(value));
  const removed = [...oldPerms].filter(value => !newPerms.has(value));
  const lines = [];
  if (added.length) lines.push(`Permissions added: ${added.join(', ')}`);
  if (removed.length) lines.push(`Permissions removed: ${removed.join(', ')}`);
  return lines;
}

function collectOverwriteMap(channel) {
  const map = new Map();
  const overwrites = channel?.permissionOverwrites?.cache;
  if (!overwrites) return map;
  for (const overwrite of overwrites.values()) {
    if (!overwrite) continue;
    map.set(`${overwrite.type}:${overwrite.id}`, {
      type: overwrite.type,
      id: overwrite.id,
      allow: String(overwrite.allow?.bitfield ?? '0'),
      deny: String(overwrite.deny?.bitfield ?? '0'),
    });
  }
  return map;
}

function formatOverwritePrincipal(overwrite) {
  if (!overwrite) return 'Unknown';
  if (overwrite.type === OverwriteType.Role || overwrite.type === 0) return `<@&${overwrite.id}>`;
  return `<@${overwrite.id}>`;
}

function diffChannelOverwrites(oldChannel, newChannel, maxLines = 8) {
  const oldMap = collectOverwriteMap(oldChannel);
  const newMap = collectOverwriteMap(newChannel);
  const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const changes = [];
  for (const key of keys) {
    const before = oldMap.get(key);
    const after = newMap.get(key);
    if (!before && after) {
      changes.push(`Permission added for ${formatOverwritePrincipal(after)}`);
      continue;
    }
    if (before && !after) {
      changes.push(`Permission removed for ${formatOverwritePrincipal(before)}`);
      continue;
    }
    if (!before || !after) continue;
    if (before.allow !== after.allow || before.deny !== after.deny) {
      changes.push(`Permission changed for ${formatOverwritePrincipal(after)}`);
    }
  }
  if (changes.length > maxLines) {
    const hidden = changes.length - maxLines;
    return [...changes.slice(0, maxLines), `+${hidden} more permission change(s)`];
  }
  return changes;
}

function markAuditEntry(cache, entry) {
  if (!entry?.id) return false;
  const id = String(entry.id);
  if (cache.has(id)) return false;
  cache.set(id, Date.now());
  if (cache.size > AUDIT_CACHE_MAX_SIZE) {
    const cutoff = Date.now() - AUDIT_CACHE_TTL_MS;
    for (const [cacheId, seenAt] of cache.entries()) {
      if (seenAt < cutoff) cache.delete(cacheId);
    }
  }
  return true;
}

function markWebhookAudit(entry) {
  return markAuditEntry(WEBHOOK_AUDIT_CACHE, entry);
}

function markIntegrationAudit(entry) {
  return markAuditEntry(INTEGRATION_AUDIT_CACHE, entry);
}

function buildRoleEmbed(action, role, color, actor = 'System', reason = null, extraFields = []) {
  return buildLogEmbed({
    action,
    target: `Role: ${role.name} (${role.id})`,
    actor,
    reason: reason || `Color: ${niceColor(role.color)}, Position: ${role.position}`,
    color,
    extraFields: [
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
      { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
      { name: 'Permissions', value: role.permissions.toArray().join(', ') || 'None', inline: false },
      ...extraFields,
    ],
    thumbnailTarget: role,
  });
}

function buildChannelEmbed(action, channel, color, reasonSuffix, actor = 'System', extraFields = []) {
  return buildLogEmbed({
    action,
    target: `${isCategory(channel) ? 'Category' : 'Channel'}: ${channel.name} (${channel.id})`,
    actor,
    reason: reasonSuffix || describeChannel(channel),
    color,
    extraFields: [
      { name: 'Type', value: formatChannelType(channel), inline: true },
      { name: 'Category', value: channel.parent ? `<#${channel.parentId}>` : 'None', inline: true },
      ...extraFields,
    ],
    thumbnailTarget: channel.guild?.iconURL ? channel.guild : null,
  });
}

function buildGuildEmbed(action, guild, reason, color, actor = 'System') {
  return buildLogEmbed({
    action,
    target: `Server: ${guild.name} (${guild.id})`,
    actor,
    reason: reason || 'Server metadata updated',
    color,
    extraFields: [
      { name: 'Member Count', value: `${guild.memberCount}`, inline: true },
    ],
    thumbnailTarget: guild,
  });
}

function buildInviteEmbed(action, guild, details, color) {
  const inviteLink = details.link || (details.code ? `https://discord.gg/${details.code}` : 'Unknown invite');
  const inviterLabel = details.inviter || formatUserTag(details.creator, 'Unknown');

  return buildLogEmbed({
    action,
    target: details.creator || inviterLabel || `Invite: ${details.code}`,
    actor: details.creator || 'System',
    reason: details.reason || 'Invite activity',
    color,
    extraFields: [
      { name: 'Link', value: inviteLink, inline: false },
      { name: 'Channel', value: details.channel || 'Unknown', inline: true },
      { name: 'Inviter', value: inviterLabel || 'Unknown', inline: true },
      { name: 'Uses', value: `${details.uses ?? 0}`, inline: true },
    ],
    thumbnailTarget: details.thumbnailTarget || details.creator || null,
  });
}

async function handleRoleCreate(role) {
  const audit = await findRecentAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
  const actor = audit?.executor || 'System';
  const embed = buildRoleEmbed('Role Created', role, 0x57f287, actor);
  await safeLog(role.guild, 'role_create', embed);
}

async function handleRoleDelete(role) {
  const audit = await findRecentAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
  const actor = audit?.executor || 'System';
  const embed = buildRoleEmbed('Role Deleted', role, 0xed4245, actor);
  await safeLog(role.guild, 'role_delete', embed);
}

async function handleRoleUpdate(oldRole, newRole) {
  const audit = await findRecentAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  const actor = audit?.executor || 'System';
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`Name changed to ${newRole.name}`);
  if (oldRole.color !== newRole.color) changes.push(`Color changed to ${niceColor(newRole.color)}`);
  if (oldRole.position !== newRole.position) changes.push(`Position changed to ${newRole.position}`);
  changes.push(...diffRolePermissions(oldRole, newRole));
  if (!changes.length) return;
  const embed = buildLogEmbed({
    action: 'Role Updated',
    target: `Role: ${newRole.name} (${newRole.id})`,
    actor,
    reason: changes.join('\n'),
    color: 0xf1c40f,
    extraFields: [
      { name: 'Hoisted', value: newRole.hoist ? 'Yes' : 'No', inline: true },
      { name: 'Mentionable', value: newRole.mentionable ? 'Yes' : 'No', inline: true },
      { name: 'Permissions', value: newRole.permissions.toArray().join(', ') || 'None', inline: false },
    ],
    thumbnailTarget: newRole,
  });
  await safeLog(newRole.guild, 'role_update', embed);
}

async function handleChannelCreate(channel) {
  const audit = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  const actor = audit?.executor || 'System';
  const viewRoles = formatViewableRoles(channel);
  const action = isCategory(channel) ? 'Category Created' : 'Channel Created';
  const logType = isCategory(channel) ? 'category_create' : 'channel_create';
  const embed = buildChannelEmbed(action, channel, 0x57f287, null, actor, [
    { name: 'Roles That Can View', value: viewRoles, inline: false },
  ]);
  await safeLog(channel.guild, logType, embed);
}

async function handleChannelDelete(channel) {
  const audit = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  const actor = audit?.executor || 'System';
  const action = isCategory(channel) ? 'Category Deleted' : 'Channel Deleted';
  const logType = isCategory(channel) ? 'category_delete' : 'channel_delete';
  const embed = buildChannelEmbed(action, channel, 0xed4245, null, actor);
  await safeLog(channel.guild, logType, embed);
}

async function handleChannelUpdate(oldChannel, newChannel) {
  if (!newChannel.guild) return;
  const changes = [];
  const audit = await findRecentAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
  const actor = audit?.executor || 'System';
  if (oldChannel.name !== newChannel.name) changes.push(`Name set to ${newChannel.name}`);
  if ((oldChannel.topic || '') !== (newChannel.topic || '')) changes.push('Topic updated');
  if (oldChannel.nsfw !== newChannel.nsfw) changes.push(newChannel.nsfw ? 'NSFW enabled' : 'NSFW disabled');
  const oldPos = Number.isFinite(oldChannel.rawPosition) ? oldChannel.rawPosition : null;
  const newPos = Number.isFinite(newChannel.rawPosition) ? newChannel.rawPosition : null;
  if (oldPos !== null && newPos !== null && oldPos !== newPos) {
    changes.push(`Placement changed: ${oldPos} -> ${newPos}`);
  }
  if (String(oldChannel.parentId || '') !== String(newChannel.parentId || '')) {
    changes.push(`Category changed: ${oldChannel.parentId ? `<#${oldChannel.parentId}>` : 'None'} -> ${newChannel.parentId ? `<#${newChannel.parentId}>` : 'None'}`);
  }
  changes.push(...diffChannelOverwrites(oldChannel, newChannel));
  if (!changes.length) return;
  const action = isCategory(newChannel) ? 'Category Updated' : 'Channel Updated';
  const logType = isCategory(newChannel) ? 'category_update' : 'channel_update';
  const embed = buildChannelEmbed(action, newChannel, 0xf39c12, changes.join('\n'), actor, [
    { name: 'Roles That Can View', value: formatViewableRoles(newChannel), inline: false },
  ]);
  await safeLog(newChannel.guild, logType, embed);
}

async function handleThreadCreate(thread) {
  const embed = buildLogEmbed({
    action: 'Thread Created',
    target: `Thread: ${thread.name} (${thread.id})`,
    actor: 'System',
    reason: `Parent channel: <#${thread.parentId}>`,
    color: 0x57f287,
    extraFields: [{ name: 'Type', value: thread.type, inline: true }],
    thumbnailTarget: thread.guild,
  });
  await safeLog(thread.guild, 'channel', embed);
}

async function handleThreadDelete(thread) {
  if (!thread.guild) return;
  const embed = buildLogEmbed({
    action: 'Thread Deleted',
    target: `Thread: ${thread.name} (${thread.id})`,
    actor: 'System',
    reason: `Parent channel: <#${thread.parentId}>`,
    color: 0xed4245,
    thumbnailTarget: thread.guild,
  });
  await safeLog(thread.guild, 'channel', embed);
}

async function handleThreadUpdate(oldThread, newThread) {
  if (!newThread.guild) return;
  const changes = [];
  if (oldThread.name !== newThread.name) changes.push(`Name changed to ${newThread.name}`);
  if (oldThread.archived !== newThread.archived) changes.push(newThread.archived ? 'Archived' : 'Unarchived');
  if (oldThread.locked !== newThread.locked) changes.push(newThread.locked ? 'Locked' : 'Unlocked');
  if (!changes.length) return;
  const embed = buildLogEmbed({
    action: 'Thread Updated',
    target: `Thread: ${newThread.name} (${newThread.id})`,
    actor: 'System',
    reason: changes.join('; '),
    color: 0xf39c12,
    thumbnailTarget: newThread.guild,
  });
  await safeLog(newThread.guild, 'channel', embed);
}

async function handleVoiceState(oldState, newState) {
  const member = newState.member || oldState?.member;
  if (!member || member.user?.bot) return;
  const guild = member.guild || newState.guild || oldState?.guild;
  if (!guild) return;
  if (!oldState?.channelId && newState.channelId) {
    const embed = buildLogEmbed({
      action: 'Voice Joined',
      target: member.user,
      actor: member.user,
      reason: `<#${newState.channelId}>`,
      color: 0x57f287,
    });
    await safeLog(guild, 'voice', embed);
    return;
  }
  if (oldState?.channelId && !newState.channelId) {
    const embed = buildLogEmbed({
      action: 'Voice Left',
      target: member.user,
      actor: member.user,
      reason: `<#${oldState.channelId}>`,
      color: 0xed4245,
    });
    await safeLog(guild, 'voice', embed);
    return;
  }
  if (oldState?.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const embed = buildLogEmbed({
      action: 'Voice Moved',
      target: member.user,
      actor: member.user,
      reason: `<#${oldState.channelId}> → <#${newState.channelId}>`,
      color: 0xf1c40f,
    });
    await safeLog(guild, 'voice', embed);
  }
}

async function handleEmojiAction(action, emoji) {
  if (!emoji.guild) return;
  const isCreate = action === 'created';
  const embed = await buildEmojiStickerAuditEmbed({
    guild: emoji.guild,
    eventLabel: `Emoji ${isCreate ? 'Added' : 'Removed'}`,
    itemType: 'Emoji',
    item: emoji,
    auditType: isCreate ? AuditLogEvent.EmojiCreate : AuditLogEvent.EmojiDelete,
    color: isCreate ? 0x57f287 : 0xed4245,
    details: `Animated: ${emoji.animated ? 'Yes' : 'No'}`,
  });
  await safeLog(emoji.guild, isCreate ? 'emoji_sticker_add' : 'emoji_sticker_delete', embed);
}

async function handleEmojiUpdate(oldEmoji, newEmoji) {
  if (!newEmoji.guild) return;
  const changes = [];
  if (oldEmoji.name !== newEmoji.name) changes.push(`Name → ${newEmoji.name}`);
  if (oldEmoji.animated !== newEmoji.animated) changes.push(newEmoji.animated ? 'Animated enabled' : 'Animated disabled');
  if (!changes.length) return;
  const embed = await buildEmojiStickerAuditEmbed({
    guild: newEmoji.guild,
    eventLabel: 'Emoji Edited',
    itemType: 'Emoji',
    item: newEmoji,
    auditType: AuditLogEvent.EmojiUpdate,
    color: 0xf1c40f,
    details: changes.join('; '),
  });
  await safeLog(newEmoji.guild, 'emoji_sticker_edit', embed);
}

async function handleStickerAction(action, sticker) {
  if (!sticker.guild) return;
  const isCreate = action === 'created';
  const embed = await buildEmojiStickerAuditEmbed({
    guild: sticker.guild,
    eventLabel: `Sticker ${isCreate ? 'Added' : 'Removed'}`,
    itemType: 'Sticker',
    item: sticker,
    auditType: isCreate ? AuditLogEvent.StickerCreate : AuditLogEvent.StickerDelete,
    color: isCreate ? 0x57f287 : 0xed4245,
    details: `Available: ${sticker.available ? 'Yes' : 'No'}`,
  });
  await safeLog(sticker.guild, isCreate ? 'emoji_sticker_add' : 'emoji_sticker_delete', embed);
}

async function handleStickerUpdate(oldSticker, newSticker) {
  if (!newSticker.guild) return;
  const changes = [];
  if (oldSticker.name !== newSticker.name) changes.push(`Name → ${newSticker.name}`);
  if (oldSticker.description !== newSticker.description) changes.push('Description updated');
  if (!changes.length) return;
  const embed = await buildEmojiStickerAuditEmbed({
    guild: newSticker.guild,
    eventLabel: 'Sticker Edited',
    itemType: 'Sticker',
    item: newSticker,
    auditType: AuditLogEvent.StickerUpdate,
    color: 0xf1c40f,
    details: changes.join('; '),
  });
  await safeLog(newSticker.guild, 'emoji_sticker_edit', embed);
}

async function handleGuildUpdate(oldGuild, newGuild) {
  const audit = await findRecentAuditEntry(newGuild, AuditLogEvent.GuildUpdate, null);
  const actor = audit?.executor || 'System';
  const changes = [];
  if (oldGuild?.name !== newGuild?.name) changes.push(`Name: ${newGuild.name}`);
  if (oldGuild?.icon !== newGuild?.icon) changes.push('Icon changed');
  if (oldGuild?.banner !== newGuild?.banner) changes.push('Banner changed');
  if (oldGuild?.description !== newGuild?.description) changes.push('Description updated');
  if (!changes.length) return;
  const embed = buildGuildEmbed('Server Settings Changed', newGuild, changes.join('\n'), 0xf39c12, actor);
  await safeLog(newGuild, 'server', embed);
}

async function handleGuildCreate(guild) {
  const embed = buildGuildEmbed('Server Joined', guild, 'Bot joined server', 0x57f287);
  await safeLog(guild, 'server', embed);
}

async function handleGuildDelete(guild) {
  const embed = buildGuildEmbed('Server Left', guild, 'Bot removed or left', 0xed4245);
  await safeLog(guild, 'server', embed);
}

async function handleGuildUnavailable(guild) {
  const embed = buildLogEmbed({
    action: 'Server Unavailable',
    target: `Server: ${guild.name} (${guild.id})`,
    actor: 'System',
    reason: 'Guild became unavailable',
    color: 0xf39c12,
  });
  await safeLog(guild, 'system', embed);
}

async function handleIntegrationsUpdate(guild) {
  if (!guild) return;
  let me = guild.members?.me;
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch (_) { me = null; }
  }
  const now = Date.now();
  const canViewAudit = Boolean(me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog));
  debugIntegration(guild, 'GuildIntegrationsUpdate detected', { canViewAudit });

  try {
    if (canViewAudit) {
      const [createLogs, updateLogs, deleteLogs] = await Promise.all([
        guild.fetchAuditLogs({ type: AuditLogEvent.IntegrationCreate, limit: 6 }),
        guild.fetchAuditLogs({ type: AuditLogEvent.IntegrationUpdate, limit: 6 }),
        guild.fetchAuditLogs({ type: AuditLogEvent.IntegrationDelete, limit: 6 }),
      ]);

      const candidates = [];
      for (const entry of createLogs.entries.values()) {
        if (!entry?.createdTimestamp || (now - entry.createdTimestamp) > AUDIT_EVENT_WINDOW_MS) continue;
        candidates.push({ entry, action: 'created', color: 0x57f287 });
      }
      for (const entry of updateLogs.entries.values()) {
        if (!entry?.createdTimestamp || (now - entry.createdTimestamp) > AUDIT_EVENT_WINDOW_MS) continue;
        candidates.push({ entry, action: 'updated', color: 0xf39c12 });
      }
      for (const entry of deleteLogs.entries.values()) {
        if (!entry?.createdTimestamp || (now - entry.createdTimestamp) > AUDIT_EVENT_WINDOW_MS) continue;
        candidates.push({ entry, action: 'deleted', color: 0xed4245 });
      }
      debugIntegration(guild, 'Audit candidates collected', {
        create: createLogs.entries.size,
        update: updateLogs.entries.size,
        delete: deleteLogs.entries.size,
        matched: candidates.length,
      });

      candidates.sort((a, b) => (Number(b.entry?.createdTimestamp) || 0) - (Number(a.entry?.createdTimestamp) || 0));
      const selected = candidates.find(candidate => markIntegrationAudit(candidate.entry)) || null;
      if (selected) {
        debugIntegration(guild, 'Using audit path', {
          action: selected.action,
          auditId: selected.entry?.id || null,
          targetId: selected.entry?.target?.id || null,
        });
        const targetName = selected.entry?.target?.name || 'Unknown';
        const targetId = selected.entry?.target?.id || 'unknown';
        const integrationType = selected.entry?.target?.type
          || selected.entry?.changes?.find(change => change?.key === 'type')?.new
          || selected.entry?.changes?.find(change => change?.key === 'type')?.old
          || 'Unknown';
        const reason = [
          `Type: ${integrationType}`,
          selected.entry?.reason ? `Reason: ${selected.entry.reason}` : null,
        ].filter(Boolean).join('\n');
        const embed = buildLogEmbed({
          action: `Integration ${selected.action}`,
          target: `Integration: ${targetName} (${targetId})`,
          actor: selected.entry?.executor || 'System',
          reason,
          color: selected.color,
        });
        await safeLog(guild, 'integration', embed);
        return;
      }
      debugIntegration(guild, 'No unused audit entry matched; falling back');
    }

    // Fallback when audit data is unavailable: emit one throttled generic event so integration changes are still visible.
    const lastFallback = INTEGRATION_FALLBACK_CACHE.get(guild.id) || 0;
    if ((now - lastFallback) < INTEGRATION_FALLBACK_THROTTLE_MS) {
      debugIntegration(guild, 'Fallback path throttled', { msSinceLast: now - lastFallback });
      return;
    }
    INTEGRATION_FALLBACK_CACHE.set(guild.id, now);

    let countValue = 'Unknown';
    try {
      const integrations = await guild.fetchIntegrations();
      if (typeof integrations?.size === 'number') countValue = String(integrations.size);
    } catch (_) {}
    debugIntegration(guild, 'Using fallback path', { countValue, canViewAudit });

    const fallbackEmbed = buildLogEmbed({
      action: 'Integration Updated',
      target: `Server: ${guild.name} (${guild.id})`,
      actor: 'System',
      reason: canViewAudit
        ? 'An integration changed, but no recent audit entry was matched.'
        : 'An integration changed. Grant View Audit Log to include actor and integration details.',
      color: 0xf39c12,
      extraFields: [
        { name: 'Current Integrations', value: countValue, inline: true },
      ],
    });
    await safeLog(guild, 'integration', fallbackEmbed);
  } catch (err) {
    debugIntegration(guild, 'Integration logging failed', { error: err?.message || String(err) });
    console.error('Failed to log integration updates:', err);
  }
}

function matchWebhookChannel(entry, channelId) {
  const auditChannelId = entry?.extra?.channel?.id || entry?.extra?.channelId || null;
  if (!auditChannelId || !channelId) return true;
  return String(auditChannelId) === String(channelId);
}

async function findRecentWebhookAudit(guild, channelId) {
  if (!guild) return null;
  const me = guild.members?.me;
  if (!me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) return null;
  const now = Date.now();
  try {
    const [createLogs, deleteLogs] = await Promise.all([
      guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 6 }),
      guild.fetchAuditLogs({ type: AuditLogEvent.WebhookDelete, limit: 6 }),
    ]);

    const createEntry = createLogs.entries.find(entry =>
      entry?.createdTimestamp
      && (now - entry.createdTimestamp) <= AUDIT_EVENT_WINDOW_MS
      && matchWebhookChannel(entry, channelId),
    ) || null;
    const deleteEntry = deleteLogs.entries.find(entry =>
      entry?.createdTimestamp
      && (now - entry.createdTimestamp) <= AUDIT_EVENT_WINDOW_MS
      && matchWebhookChannel(entry, channelId),
    ) || null;

    let selected = null;
    let logType = null;
    if (createEntry && deleteEntry) {
      const createTs = Number(createEntry.createdTimestamp) || 0;
      const deleteTs = Number(deleteEntry.createdTimestamp) || 0;
      if (createTs >= deleteTs) {
        selected = createEntry;
        logType = 'webhook_create';
      } else {
        selected = deleteEntry;
        logType = 'webhook_delete';
      }
    } else if (createEntry) {
      selected = createEntry;
      logType = 'webhook_create';
    } else if (deleteEntry) {
      selected = deleteEntry;
      logType = 'webhook_delete';
    }

    if (!selected || !markWebhookAudit(selected)) return null;
    return { entry: selected, logType };
  } catch (err) {
    console.error('Failed to read webhook audit logs:', err);
    return null;
  }
}

async function handleWebhooksUpdate(channel) {
  const guild = channel?.guild;
  if (!guild) return;
  const audited = await findRecentWebhookAudit(guild, channel?.id);
  if (!audited) return;
  const { entry, logType } = audited;
  const action = logType === 'webhook_create' ? 'Webhook Created' : 'Webhook Deleted';
  const targetName = entry?.target?.name || 'Unknown';
  const targetId = entry?.target?.id || 'unknown';
  const actor = entry?.executor || 'System';
  const embed = buildLogEmbed({
    action,
    target: `Webhook: ${targetName} (${targetId})`,
    actor,
    reason: `Channel: ${channel?.id ? `<#${channel.id}>` : 'Unknown'}`,
    color: logType === 'webhook_create' ? 0x57f287 : 0xed4245,
  });
  await safeLog(guild, logType, embed);
}

async function handleInviteCreate(invite) {
  const guild = invite.guild;
  if (!guild) return;
  inviteTracker.addInvite(invite);
  const inviterLabel = invite.inviter ? `${invite.inviter.tag} (${invite.inviter.id})` : 'Unknown';
  const inviteLink = invite.url || (invite.code ? `https://discord.gg/${invite.code}` : 'Unknown invite');
  const embed = buildInviteEmbed('Invite Created', guild, {
    code: invite.code,
    link: inviteLink,
    channel: invite.channelId ? `<#${invite.channelId}>` : 'Unknown',
    inviter: inviterLabel,
    creator: invite.inviter || inviterLabel,
    uses: invite.uses ?? 0,
    reason: 'Invite generated',
    thumbnailTarget: invite.inviter || null,
  }, INVITE_LOG_COLOR);
  await safeLog(guild, 'invite_create', embed);
}

async function handleInviteDelete(invite) {
  const guild = invite.guild || invite.inviter?.guild;
  if (!guild) return;
  inviteTracker.removeInvite(guild.id, invite.code);
  const inviterLabel = invite.inviter ? `${invite.inviter.tag} (${invite.inviter.id})` : 'Unknown';
  const inviteLink = invite.url || (invite.code ? `https://discord.gg/${invite.code}` : 'Unknown invite');
  const embed = buildInviteEmbed('Invite Deleted', guild, {
    code: invite.code,
    link: inviteLink,
    channel: invite.channelId ? `<#${invite.channelId}>` : 'Unknown',
    inviter: inviterLabel,
    creator: invite.inviter || inviterLabel,
    uses: invite.uses ?? 0,
    reason: 'Invite removed',
    thumbnailTarget: invite.inviter || null,
  }, INVITE_LOG_COLOR);
  await safeLog(guild, 'invite_delete', embed);
}

async function handleAutoModRule(action, rule) {
  const guild = rule.guild;
  if (!guild) return;
  const embed = buildLogEmbed({
    action: `AutoMod Rule ${action}`,
    target: `Rule: ${rule.name} (${rule.id})`,
    actor: 'System',
    reason: `Enabled: ${rule.enabled ? 'Yes' : 'No'}`,
    color: action === 'created' ? 0x57f287 : action === 'deleted' ? 0xed4245 : 0xf39c12,
  });
  await safeLog(guild, 'automod', embed);
}

async function handleAutoModAction(execution) {
  const guild = execution.guild;
  if (!guild) return;
  const target = execution.args?.user ? `${execution.args.user.tag} (${execution.args.user.id})` : 'Unknown target';
  const embed = buildLogEmbed({
    action: 'AutoMod Action Triggered',
    target,
    actor: execution.executor?.user || 'System',
    reason: execution.action?.type || 'Action performed',
    color: 0xf1c40f,
    extraFields: [
      { name: 'Channel', value: execution.channel ? `<#${execution.channel.id}>` : 'Unknown', inline: true },
      { name: 'Message', value: execution.message ? `[Jump to message](${execution.message.url})` : 'None', inline: true },
    ],
  });
  await safeLog(guild, 'automod', embed);
}

function registerHandlers(client) {
  client.on(Events.GuildRoleCreate, role => handleRoleCreate(role));
  client.on(Events.GuildRoleDelete, role => handleRoleDelete(role));
  client.on(Events.GuildRoleUpdate, (oldRole, newRole) => handleRoleUpdate(oldRole, newRole));
  client.on(Events.ChannelCreate, channel => handleChannelCreate(channel));
  client.on(Events.ChannelDelete, channel => handleChannelDelete(channel));
  client.on(Events.ChannelUpdate, (oldChannel, newChannel) => handleChannelUpdate(oldChannel, newChannel));
  client.on(Events.ThreadCreate, thread => handleThreadCreate(thread));
  client.on(Events.ThreadDelete, thread => handleThreadDelete(thread));
  client.on(Events.ThreadUpdate, (oldThread, newThread) => handleThreadUpdate(oldThread, newThread));
  client.on(Events.VoiceStateUpdate, (oldState, newState) => handleVoiceState(oldState, newState));
  client.on(Events.GuildEmojiCreate, emoji => handleEmojiAction('created', emoji));
  client.on(Events.GuildEmojiDelete, emoji => handleEmojiAction('deleted', emoji));
  client.on(Events.GuildEmojiUpdate, (oldEmoji, newEmoji) => handleEmojiUpdate(oldEmoji, newEmoji));
  client.on(Events.GuildStickerCreate, sticker => handleStickerAction('created', sticker));
  client.on(Events.GuildStickerDelete, sticker => handleStickerAction('deleted', sticker));
  client.on(Events.GuildStickerUpdate, (oldSticker, newSticker) => handleStickerUpdate(oldSticker, newSticker));
  client.on(Events.GuildUpdate, (oldGuild, newGuild) => handleGuildUpdate(oldGuild, newGuild));
  client.on(Events.GuildCreate, guild => handleGuildCreate(guild));
  client.on(Events.GuildDelete, guild => handleGuildDelete(guild));
  client.on(Events.GuildIntegrationsUpdate, guild => {
    void handleIntegrationsUpdate(guild);
  });
  client.on(Events.WebhooksUpdate, channel => {
    void handleWebhooksUpdate(channel);
  });
  client.on(Events.InviteCreate, invite => handleInviteCreate(invite));
  client.on(Events.InviteDelete, invite => handleInviteDelete(invite));
  client.on(Events.AutoModerationRuleCreate, rule => handleAutoModRule('created', rule));
  client.on(Events.AutoModerationRuleDelete, rule => handleAutoModRule('deleted', rule));
  client.on(Events.AutoModerationRuleUpdate, (oldRule, newRule) => handleAutoModRule('updated', newRule));
  client.on(Events.AutoModerationActionExecution, execution => handleAutoModAction(execution));
  client.on(Events.GuildAvailable, guild => inviteTracker.refreshGuildInvites(guild));
  client.on(Events.GuildUnavailable, guild => handleGuildUnavailable(guild));
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await inviteTracker.initialize(client);
    registerHandlers(client);
  },
};
