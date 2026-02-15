const { Events, PermissionsBitField, EmbedBuilder } = require('discord.js');
const stickyStore = require('../utils/stickyMessageStore');

const timers = new Map();
const stickyPostSuppressions = new Map();

function timerKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function clearStickyTimer(guildId, channelId) {
  const key = timerKey(guildId, channelId);
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
    timers.delete(key);
  }
}

function markStickyPostSuppression(guildId, channelId, ttlMs = 15000) {
  if (!guildId || !channelId) return;
  stickyPostSuppressions.set(timerKey(guildId, channelId), Date.now() + ttlMs);
}

function consumeStickyPostSuppression(guildId, channelId) {
  if (!guildId || !channelId) return false;
  const key = timerKey(guildId, channelId);
  const expiresAt = stickyPostSuppressions.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    stickyPostSuppressions.delete(key);
    return false;
  }
  stickyPostSuppressions.delete(key);
  return true;
}

async function buildSourceClonePayload(guild, config, fallbackContent) {
  if (!guild || !config?.sourceMessageId) {
    return fallbackContent ? { content: fallbackContent } : null;
  }

  const sourceChannelId = config.sourceChannelId;
  const sourceChannel = sourceChannelId
    ? await guild.channels.fetch(sourceChannelId).catch(() => null)
    : null;
  if (!sourceChannel?.isTextBased?.()) {
    return fallbackContent ? { content: fallbackContent } : null;
  }

  const sourceMessage = await sourceChannel.messages.fetch(config.sourceMessageId).catch(() => null);
  if (!sourceMessage) {
    return fallbackContent ? { content: fallbackContent } : null;
  }

  const payload = {};
  if (sourceMessage.content) payload.content = sourceMessage.content;
  if (Array.isArray(sourceMessage.embeds) && sourceMessage.embeds.length) {
    payload.embeds = sourceMessage.embeds.map(embed => embed.toJSON());
  }
  if (Array.isArray(sourceMessage.components) && sourceMessage.components.length) {
    payload.components = sourceMessage.components.map(component => component.toJSON());
  }
  if (sourceMessage.attachments?.size) {
    payload.files = Array.from(sourceMessage.attachments.values())
      .map(attachment => attachment.url)
      .filter(Boolean);
  }

  if (!payload.content && !payload.embeds && !payload.components && !payload.files) {
    return fallbackContent ? { content: fallbackContent } : null;
  }
  return payload;
}

async function postStickyMessage(message, config) {
  const { guild, channel } = message;
  if (!guild || !channel || !config) return;

  let me = guild.members.me;
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch (err) {
      console.warn(`Sticky message skipped: failed to fetch bot member for guild ${guild.id}:`, err?.message || err);
      return;
    }
  }

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) {
    console.warn(`Sticky message skipped: missing ViewChannel in ${guild.id}/${channel.id}`);
    return;
  }
  if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
    console.warn(`Sticky message skipped: missing SendMessages in ${guild.id}/${channel.id}`);
    return;
  }

  if (config.stickyMessageId && perms.has(PermissionsBitField.Flags.ManageMessages)) {
    try {
      const oldMessage = await channel.messages.fetch(config.stickyMessageId);
      if (oldMessage?.author?.id === message.client.user.id) {
        await oldMessage.delete();
      }
    } catch (_) {}
  }

  let payload;
  if (config.sourceMessageId) {
    payload = await buildSourceClonePayload(guild, config, config.content || '');
    if (!payload) {
      console.warn(`Sticky message skipped: source clone payload empty in ${guild.id}/${channel.id}`);
      return;
    }
    if (payload.embeds && !perms.has(PermissionsBitField.Flags.EmbedLinks)) {
      delete payload.embeds;
      console.warn(`Sticky source clone: missing EmbedLinks in ${guild.id}/${channel.id}, dropped embeds.`);
    }
    if (payload.files && !perms.has(PermissionsBitField.Flags.AttachFiles)) {
      delete payload.files;
      console.warn(`Sticky source clone: missing AttachFiles in ${guild.id}/${channel.id}, dropped attachments.`);
    }
    if (!payload.content && !payload.embeds && !payload.components && !payload.files) {
      console.warn(`Sticky message skipped: no sendable source clone payload in ${guild.id}/${channel.id}`);
      return;
    }
  } else if (config.mode === 'embed' && perms.has(PermissionsBitField.Flags.EmbedLinks)) {
    payload = { embeds: [new EmbedBuilder().setDescription(config.content)] };
  } else {
    if (config.mode === 'embed' && !perms.has(PermissionsBitField.Flags.EmbedLinks)) {
      console.warn(`Sticky message fallback: missing EmbedLinks in ${guild.id}/${channel.id}, sending plain text.`);
    }
    payload = { content: config.content };
  }

  let sent;
  // Prevent this freshly-sent sticky message from re-triggering the timer.
  markStickyPostSuppression(guild.id, channel.id);
  sent = await channel.send(payload);

  await stickyStore.setStickyMessageId(guild.id, channel.id, sent.id);
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || !message.channel) return;
    const config = await stickyStore.getChannelConfig(message.guild.id, message.channel.id);
    if (!config?.content && !config?.sourceMessageId) return;
    if (!message.client?.user?.id) return;

    if (message.author?.bot) {
      // Ignore sticky posts generated by this handler, but let other bot-originated
      // messages from this same bot count as activity.
      if (message.author.id !== message.client.user.id) return;
      if (message.id === config.stickyMessageId) return;
      if (consumeStickyPostSuppression(message.guild.id, message.channel.id)) return;
    }

    clearStickyTimer(message.guild.id, message.channel.id);
    const key = timerKey(message.guild.id, message.channel.id);

    const timer = setTimeout(async () => {
      timers.delete(key);
      const latestConfig = await stickyStore.getChannelConfig(message.guild.id, message.channel.id);
      if (!latestConfig?.content && !latestConfig?.sourceMessageId) return;
      try {
        await postStickyMessage(message, latestConfig);
      } catch (err) {
        console.warn('Failed to post sticky message:', err?.message || err);
      }
    }, Math.max(1000, config.delayMs || 5000));

    timers.set(key, timer);
  },
};
