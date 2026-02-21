const { Events, AuditLogEvent, PermissionsBitField } = require('discord.js');
const logSender = require('../utils/logSender');
const joinLeaveStore = require('../utils/joinLeaveStore');
const leaveTrackerStore = require('../utils/leaveTrackerStore');
const { buildLeaveEmbed } = require('../utils/leaveTrackerEmbed');
const { buildMemberLogEmbed } = require('../utils/memberLogEmbed');
const { BOT_LOG_KEYS, BOT_ACTION_COLORS, buildBotLogEmbed } = require('../utils/botLogEmbed');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      const guild = member.guild;
      const client = member.client;
      const now = Date.now();
      // Determine if kicked/banned via audit logs (best-effort)
      const departure = { type: 'left', executorId: null, executorTag: null };
      const me = guild.members.me;
      if (me && me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        try {
          const logs = await guild.fetchAuditLogs({ limit: 5 });
          const recent = logs.entries
            .filter(e => (now - e.createdTimestamp) < 10_000)
            .filter(e => e.target?.id === member.id);
          const ban = recent.find(e => e.action === AuditLogEvent.MemberBanAdd);
          const kick = recent.find(e => e.action === AuditLogEvent.MemberKick);
          if (ban) {
            departure.type = 'ban';
            departure.executorId = ban.executor?.id || null;
            departure.executorTag = ban.executor?.tag || null;
          } else if (kick) {
            departure.type = 'kick';
            departure.executorId = kick.executor?.id || null;
            departure.executorTag = kick.executor?.tag || null;
          }
        } catch (_) { /* ignore */ }
      }

      try {
        joinLeaveStore.addEvent(guild.id, member.id, 'leave', now, {
          reason: departure.type,
          executorId: departure.executorId,
          executorTag: departure.executorTag,
        });
      } catch (err) {
        console.error('Failed to record leave stats:', err);
      }

      try {
        const cfg = leaveTrackerStore.getConfig(guild.id);
        if (cfg && cfg.enabled !== false && cfg.channelId) {
          const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
          if (channel?.isTextBased?.()) {
            const stats = joinLeaveStore.getUserStats(guild.id, member.id);
            const embed = buildLeaveEmbed(member, {
              leftAt: now,
              leaveCount: stats?.leaves || 1,
              reason: departure,
            });
            await channel.send({ embeds: [embed] });
          }
        }
      } catch (err) {
        console.error('Failed to send leave tracker embed:', err);
      }

      // Bans are handled by the GuildBanAdd event to avoid duplicates.
      if (member.user?.bot && member.user.id !== member.client?.user?.id && departure.type !== 'ban') {
        try {
          const isKick = departure.type === 'kick';
          const embed = buildBotLogEmbed({
            action: isKick ? 'Kicked' : 'Left',
            botUser: member.user,
            actor: isKick && departure.executorId ? { id: departure.executorId, tag: departure.executorTag } : null,
            color: isKick ? BOT_ACTION_COLORS.moderation : BOT_ACTION_COLORS.leave,
            extraFields: [
              { name: 'Departure type', value: departure.type, inline: true },
              { name: 'Guild', value: `${guild.name} (${guild.id})`, inline: true },
            ],
          });

          await logSender.sendLog({
            guildId: guild.id,
            logType: isKick ? BOT_LOG_KEYS.moderation : BOT_LOG_KEYS.leave,
            embed,
            client,
          });
        } catch (err) {
          console.error('Failed to log bot departure:', err);
        }
      }

      if (departure.type === 'ban') return;

      // Log the member removal
      const actionLabel = departure.type === 'kick' ? 'User Kicked' : 'User Left';
      const leaveStats = joinLeaveStore.getUserStats(guild.id, member.id);
      const leaveCount = leaveStats?.leaves || 1;
      const reasonLabel = departure.type === 'kick'
        ? 'User Kicked'
        : departure.type === 'ban'
          ? 'User Banned'
          : 'User Left';
      const logEmbed = buildMemberLogEmbed({
        action: actionLabel,
        user: member.user || { id: member.id },
        color: 0xed4245,
        extraFields: [
          { name: 'Total Leaves', value: `This person has left (${leaveCount}) time${leaveCount === 1 ? '' : 's'} now.`, inline: false },
          { name: 'Reason', value: reasonLabel, inline: true },
          { name: 'Departure type', value: departure.type, inline: true },
          departure.executorId
            ? { name: 'Executor', value: departure.executorTag ? `${departure.executorTag} (${departure.executorId})` : `<@${departure.executorId}>`, inline: true }
            : null,
          { name: 'Guild', value: `${guild.name} (${guild.id})`, inline: true },
        ],
      });

      await logSender.sendLog({
        guildId: guild.id,
        logType: departure.type === 'kick' ? 'member_kick' : 'member_leave',
        embed: logEmbed,
        client,
      });
    } catch (e) {
      // swallow
    }
  },
};
