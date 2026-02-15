const { Events, PermissionsBitField, EmbedBuilder } = require('discord.js');
const stickyStore = require('../utils/stickyMessageStore');

const timers = new Map();

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

  let sent;
  if (config.mode === 'embed' && perms.has(PermissionsBitField.Flags.EmbedLinks)) {
    sent = await channel.send({ embeds: [new EmbedBuilder().setDescription(config.content)] });
  } else {
    if (config.mode === 'embed' && !perms.has(PermissionsBitField.Flags.EmbedLinks)) {
      console.warn(`Sticky message fallback: missing EmbedLinks in ${guild.id}/${channel.id}, sending plain text.`);
    }
    sent = await channel.send({ content: config.content });
  }

  await stickyStore.setStickyMessageId(guild.id, channel.id, sent.id);
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || !message.channel) return;
    if (message.author?.bot) return;

    const config = await stickyStore.getChannelConfig(message.guild.id, message.channel.id);
    if (!config?.content) return;

    clearStickyTimer(message.guild.id, message.channel.id);
    const key = timerKey(message.guild.id, message.channel.id);

    const timer = setTimeout(async () => {
      timers.delete(key);
      const latestConfig = await stickyStore.getChannelConfig(message.guild.id, message.channel.id);
      if (!latestConfig?.content) return;
      try {
        await postStickyMessage(message, latestConfig);
      } catch (err) {
        console.warn('Failed to post sticky message:', err?.message || err);
      }
    }, Math.max(1000, config.delayMs || 5000));

    timers.set(key, timer);
  },
};
