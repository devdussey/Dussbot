const { Events, AuditLogEvent, PermissionsBitField, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      if (!message?.guild || !message.channel) return;
      const guild = message.guild;
      const client = message.client;
      const me = guild.members.me;
      if (!me) return;

      // Try to identify who deleted via audit logs (requires View Audit Log)
      let executor = null;
      if (me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        try {
          const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
          // Find an entry that likely matches this deletion
          const entry = logs.entries.find(e => {
            if (!e) return false;
            // Match channel and, if available, target user
            const channelOk = (e.extra?.channel?.id === message.channel.id) || (e.extra?.channelId === message.channel.id);
            const targetOk = message.author ? (e.target?.id === message.author.id) : true;
            // Recent (within ~10s)
            const recent = (Date.now() - e.createdTimestamp) < 10_000;
            return channelOk && targetOk && recent;
          });
          if (entry) executor = entry.executor || null;
        } catch (_) {
          // ignore fetch/audit issues
        }
      }

      // Build log embed
      const authorTag = message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown (uncached)';
      const contentPreview = message.content ? (message.content.length > 1024 ? message.content.slice(0, 1021) + '…' : message.content) : '*No content available*';
      const attachInfo = message.attachments?.size ? `${message.attachments.size} attachment(s)` : 'None';

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Message Deleted')
        .setColor(0xff0000)
        .addFields(
          { name: 'Author', value: authorTag, inline: false },
          { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: false },
          { name: 'Deleted By', value: executor ? `${executor.tag} (${executor.id})` : 'Unknown', inline: false },
          { name: 'Message ID', value: message.id || 'Unknown', inline: true },
          { name: 'Attachments', value: attachInfo, inline: true },
          { name: 'Content', value: contentPreview, inline: false },
        )
        .setTimestamp();

      // Send to message log channel
      await logSender.sendLog({
        guildId: guild.id,
        logType: 'message',
        embed,
        client,
        ownerFallback: true,
      });
    } catch (err) {
      console.error('messageDelete handler error:', err);
    }
  },
};
