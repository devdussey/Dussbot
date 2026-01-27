const { Events, AuditLogEvent, PermissionsBitField } = require('discord.js');
const logSender = require('../utils/logSender');
const { buildLogEmbed } = require('../utils/logEmbedFactory');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    try {
      const guild = ban.guild;
      const user = ban.user;
      if (!guild || !user) return;

      const me = guild.members.me;
      let executor = null;
      let reason = null;

      if (me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) {
        try {
          const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 5 });
          const entry = logs.entries.find(e => e.target?.id === user.id && (Date.now() - e.createdTimestamp) < 10_000);
          if (entry) {
            executor = entry.executor || null;
            reason = entry.reason || null;
          }
        } catch (_) {}
      }

      const embed = buildLogEmbed({
        action: 'User Unbanned',
        target: user,
        actor: executor || 'System',
        reason: reason || 'N/A',
        color: 0x57f287,
        extraFields: [
          { name: 'Guild', value: `${guild.name} (${guild.id})`, inline: false },
        ],
      });

      await logSender.sendLog({
        guildId: guild.id,
        logType: 'member_unban',
        embed,
        client: guild.client,
        ownerFallback: true,
      });

      if (user.bot && user.id !== guild.client?.user?.id) {
        try {
          const botEmbed = buildBotLogEmbed({
            action: 'Bot Unbanned',
            botUser: user,
            actor: executor || 'System',
            color: BOT_ACTION_COLORS.moderation,
            description: reason || 'No reason provided',
            extraFields: [
              { name: 'Guild', value: `${guild.name} (${guild.id})`, inline: false },
            ],
          });

          await logSender.sendLog({
            guildId: guild.id,
            logType: BOT_LOG_KEYS.moderation,
            embed: botEmbed,
            client: guild.client,
          });
        } catch (err) {
          console.error('Failed to log bot unban:', err);
        }
      }
    } catch (err) {
      console.error('guildBanRemove handler error:', err);
    }
  },
};
