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
    try { me = await guild.members.fetchMe(); } catch (_) { return; }
  }

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) return;
  if (!perms?.has(PermissionsBitField.Flags.SendMessages)) return;

  if (config.stickyMessageId && perms.has(PermissionsBitField.Flags.ManageMessages)) {
    try {
      const oldMessage = await channel.messages.fetch(config.stickyMessageId);
      if (oldMessage?.author?.id === message.client.user.id) {
        await oldMessage.delete();
      }
    } catch (_) {}
  }

  let sent;
  if (config.mode === 'embed') {
    sent = await channel.send({ embeds: [new EmbedBuilder().setDescription(config.content)] });
  } else {
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
