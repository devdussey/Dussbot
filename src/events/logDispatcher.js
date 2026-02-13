const { Events, EmbedBuilder, AuditLogEvent, PermissionsBitField } = require('discord.js');
const logSender = require('../utils/logSender');
const inviteTracker = require('../utils/inviteTracker');
const { buildLogEmbed } = require('../utils/logEmbedFactory');

const INVITE_LOG_COLOR = 0x00f0ff;
const EVENT_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

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
      return (now - entry.createdTimestamp) <= 20_000;
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

function buildRoleEmbed(action, role, color) {
  return buildLogEmbed({
    action,
    target: `Role: ${role.name} (${role.id})`,
    actor: 'System',
    reason: `Color: ${niceColor(role.color)}, Position: ${role.position}`,
    color,
    extraFields: [
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
      { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
      { name: 'Permissions', value: role.permissions.toArray().join(', ') || 'None', inline: false },
    ],
    thumbnailTarget: role,
  });
}

function buildChannelEmbed(action, channel, color, reasonSuffix) {
  return buildLogEmbed({
    action,
    target: `Channel: ${channel.name} (${channel.id})`,
    actor: 'System',
    reason: reasonSuffix || describeChannel(channel),
    color,
    extraFields: [
      { name: 'Type', value: channel.isThread ? 'Thread' : channel.type, inline: true },
      { name: 'Category', value: channel.parent ? `<#${channel.parentId}>` : 'None', inline: true },
    ],
    thumbnailTarget: channel.guild?.iconURL ? channel.guild : null,
  });
}

function buildGuildEmbed(action, guild, reason, color) {
  return buildLogEmbed({
    action,
    target: `Server: ${guild.name} (${guild.id})`,
    actor: 'System',
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
  const embed = buildRoleEmbed('Role Created', role, 0x57f287);
  await safeLog(role.guild, 'role_create', embed);
}

async function handleRoleDelete(role) {
  const embed = buildRoleEmbed('Role Deleted', role, 0xed4245);
  await safeLog(role.guild, 'role_delete', embed);
}

async function handleRoleUpdate(oldRole, newRole) {
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`Name changed to ${newRole.name}`);
  if (oldRole.color !== newRole.color) changes.push(`Color changed to ${niceColor(newRole.color)}`);
  if (oldRole.position !== newRole.position) changes.push(`Position changed to ${newRole.position}`);
  if (!changes.length) return;
  const embed = buildLogEmbed({
    action: 'Role Updated',
    target: `Role: ${newRole.name} (${newRole.id})`,
    actor: 'System',
    reason: changes.join('; '),
    color: 0xf1c40f,
    extraFields: [
      { name: 'Hoisted', value: newRole.hoist ? 'Yes' : 'No', inline: true },
      { name: 'Mentionable', value: newRole.mentionable ? 'Yes' : 'No', inline: true },
    ],
    thumbnailTarget: newRole,
  });
  await safeLog(newRole.guild, 'role_update', embed);
}

async function handleChannelCreate(channel) {
  const embed = buildChannelEmbed('Channel Created', channel, 0x57f287);
  await safeLog(channel.guild, 'channel_create', embed);
}

async function handleChannelDelete(channel) {
  const embed = buildChannelEmbed('Channel Deleted', channel, 0xed4245);
  await safeLog(channel.guild, 'channel_delete', embed);
}

async function handleChannelUpdate(oldChannel, newChannel) {
  if (!newChannel.guild) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`Name set to ${newChannel.name}`);
  if ((oldChannel.topic || '') !== (newChannel.topic || '')) changes.push('Topic updated');
  if (oldChannel.nsfw !== newChannel.nsfw) changes.push(newChannel.nsfw ? 'NSFW enabled' : 'NSFW disabled');
  if (!changes.length) return;
  const embed = buildChannelEmbed('Channel Updated', newChannel, 0xf39c12, changes.join('\n'));
  await safeLog(newChannel.guild, 'channel_update', embed);
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
  const changes = [];
  if (oldGuild?.name !== newGuild?.name) changes.push(`Name: ${newGuild.name}`);
  if (oldGuild?.icon !== newGuild?.icon) changes.push('Icon changed');
  if (oldGuild?.banner !== newGuild?.banner) changes.push('Banner changed');
  if (oldGuild?.description !== newGuild?.description) changes.push('Description updated');
  if (!changes.length) return;
  const embed = buildGuildEmbed('Server Updated', newGuild, changes.join('; '), 0xf39c12);
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

async function handleIntegration(action, integration) {
  const guild = integration.guild;
  if (!guild) return;
  const embed = buildLogEmbed({
    action: `Integration ${action}`,
    target: `Integration: ${integration.name} (${integration.id})`,
    actor: 'System',
    reason: `Type: ${integration.type}`,
    color: action === 'created' ? 0x57f287 : action === 'deleted' ? 0xed4245 : 0xf39c12,
  });
  await safeLog(guild, 'integration', embed);
}

async function handleIntegrationsUpdate(guild, integrations) {
  if (!guild || !integrations?.cache?.size) return;
  try {
    for (const integration of integrations.cache.values()) {
      await handleIntegration('updated', integration);
    }
  } catch (err) {
    console.error('Failed to log integration updates:', err);
  }
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
  client.on(Events.GuildIntegrationsUpdate, (guild, integrations) => {
    void handleIntegrationsUpdate(guild, integrations);
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
