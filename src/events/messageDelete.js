const { Events, AuditLogEvent, PermissionsBitField } = require('discord.js');
const logSender = require('../utils/logSender');
const { buildLogEmbed } = require('../utils/logEmbedFactory');
const userMessageLogStore = require('../utils/userMessageLogStore');

function truncate(str, max = 1024) {
  if (!str) return '';
  const value = String(str);
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function summarizeAttachments(message) {
  if (!message?.attachments?.size) return '';
  const names = [];
  for (const att of message.attachments.values()) {
    if (!att) continue;
    if (att.name) names.push(att.name);
    else if (att.id) names.push(`attachment-${att.id}`);
    if (names.length >= 5) break;
  }
  return names.length ? names.join(', ') : '';
}

function getCachedContent(message) {
  const guildId = message?.guildId || message?.guild?.id;
  if (!guildId || !message?.author?.id) return null;
  const recent = userMessageLogStore.getRecentMessages(guildId, message.author.id, 50);
  if (!recent.length) return null;
  const exact = recent.find(entry => entry.id === message.id && entry.content);
  if (exact) return { content: exact.content, source: 'cached_exact' };
  const sameChannel = recent.filter(entry => entry.channelId === message.channelId && entry.content);
  if (sameChannel.length) {
    const nearest = sameChannel[sameChannel.length - 1];
    return { content: nearest.content, source: 'cached_channel' };
  }
  return null;
}

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      if (!message?.guild || !message.channel) return;
      const guild = message.guild;
      const me = guild.members.me;
      if (!me) return;
      let executor = null;
      if (me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        try {
          const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
          const entry = logs.entries.find(e => e.target?.id === message.author?.id && (Date.now() - e.createdTimestamp) < 10_000);
          if (entry) executor = entry.executor || null;
        } catch (_) {}
      }
      let content = message.content ? truncate(message.content) : '';
      let contentSource = 'live';
      if (!content) {
        const cached = getCachedContent(message);
        if (cached?.content) {
          content = truncate(cached.content);
          contentSource = cached.source === 'cached_exact'
            ? 'cache: exact message'
            : 'cache: recent channel message';
        }
      }
      if (!content) content = '*No content available*';

      const attachmentSummary = summarizeAttachments(message);
      const notes = [];
      if (message.partial) notes.push('Message was partial when deleted');
      if (contentSource && contentSource !== 'live') notes.push(`Content from ${contentSource}`);
      if (!notes.length && attachmentSummary) notes.push('Attachments were present');
      const embed = buildLogEmbed({
        action: 'Message Deleted',
        target: message.author || 'Unknown',
        actor: executor || 'System',
        reason: content,
        color: 0xed4245,
        extraFields: [
          { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: true },
          { name: 'Message ID', value: message.id || 'Unknown', inline: true },
          { name: 'Deleted by', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: false },
          ...(attachmentSummary ? [{ name: 'Attachments', value: truncate(attachmentSummary, 256), inline: true }] : []),
          ...(notes.length ? [{ name: 'Notes', value: notes.join('\n'), inline: false }] : []),
        ],
      });
      await logSender.sendLog({
        guildId: guild.id,
        logType: 'message_delete',
        embed,
        client: message.client,
        ownerFallback: true,
      });
    } catch (err) {
      console.error('messageDelete handler error:', err);
    }
  },
};
