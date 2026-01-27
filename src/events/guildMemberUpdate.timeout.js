const { Events, AuditLogEvent, PermissionsBitField } = require('discord.js');
const logSender = require('../utils/logSender');
const { buildLogEmbed } = require('../utils/logEmbedFactory');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

function getTimeoutTimestamp(member) {
  const ts = member?.communicationDisabledUntilTimestamp;
  if (typeof ts === 'number') return ts;
  const date = member?.communicationDisabledUntil;
  if (date instanceof Date) return date.getTime();
  return null;
}

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      if (!newMember?.guild) return;
      const guild = newMember.guild;

      const oldTs = getTimeoutTimestamp(oldMember);
      const newTs = getTimeoutTimestamp(newMember);
      if (oldTs === newTs) return;

      const now = Date.now();
      const wasTimedOut = typeof oldTs === 'number' && oldTs > now;
      const isTimedOut = typeof newTs === 'number' && newTs > now;

      let logType = null;
      let action = null;
      let color = 0xf1c40f;

      if (!wasTimedOut && isTimedOut) {
        logType = 'member_timeout';
        action = 'User Timed Out';
        color = 0xed4245;
      } else if (wasTimedOut && !isTimedOut) {
        logType = 'member_untimeout';
        action = 'User Timeout Removed';
        color = 0x57f287;
      } else if (isTimedOut) {
        logType = 'member_timeout';
        action = 'User Timeout Updated';
        color = 0xf1c40f;
      } else {
        return;
      }

      const me = guild.members.me;
      let executor = null;
      let reason = null;
      if (me?.permissions?.has(PermissionsBitField.Flags.ViewAuditLog)) {
        try {
          const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
          const entry = logs.entries.find(e => {
            if (e.target?.id !== newMember.id) return false;
            if ((Date.now() - e.createdTimestamp) >= 10_000) return false;
            const changes = e.changes || [];
            return changes.some(c => c?.key === 'communication_disabled_until' || c?.key === 'communicationDisabledUntil');
          });
          if (entry) {
            executor = entry.executor || null;
            reason = entry.reason || null;
          }
        } catch (_) {}
      }

      const extraFields = [];
      if (typeof newTs === 'number') {
        extraFields.push({ name: 'Until', value: `<t:${Math.floor(newTs / 1000)}:f>`, inline: true });
      }
      if (typeof oldTs === 'number') {
        extraFields.push({ name: 'Previous', value: `<t:${Math.floor(oldTs / 1000)}:f>`, inline: true });
      }

      const embed = buildLogEmbed({
        action,
        target: newMember.user || `${newMember.id}`,
        actor: executor || 'System',
        reason: reason || (logType === 'member_timeout' ? 'Timeout applied' : 'Timeout removed'),
        color,
        extraFields,
      });

      await logSender.sendLog({
        guildId: guild.id,
        logType,
        embed,
        client: guild.client,
      });

      if (newMember.user?.bot && newMember.user.id !== guild.client?.user?.id) {
        try {
          const botEmbed = buildBotLogEmbed({
            action: action.replace('User', 'Bot'),
            botUser: newMember.user,
            actor: executor || 'System',
            color: BOT_ACTION_COLORS.moderation,
            description: reason || (logType === 'member_timeout' ? 'Timeout applied' : 'Timeout removed'),
            extraFields,
          });

          await logSender.sendLog({
            guildId: guild.id,
            logType: BOT_LOG_KEYS.moderation,
            embed: botEmbed,
            client: guild.client,
          });
        } catch (err) {
          console.error('Failed to log bot timeout:', err);
        }
      }
    } catch (err) {
      console.error('guildMemberUpdate.timeout handler error:', err);
    }
  },
};
