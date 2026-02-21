const { Events } = require('discord.js');
const logSender = require('../utils/logSender');
const { buildLogEmbed } = require('../utils/logEmbedFactory');
const { buildMemberLogEmbed } = require('../utils/memberLogEmbed');

const GREEN = 0x2ecc71;
const RED = 0xed4245;
const YELLOW = 0xffd166;

function formatRoleLines(roles, max = 20) {
  const list = Array.from(roles || []);
  if (!list.length) return 'None';
  const shown = list.slice(0, max).map(role => `<@&${role.id}> - ${role.name}`);
  if (list.length > max) shown.push(`+${list.length - max} more role(s)`);
  return shown.join('\n').slice(0, 1024);
}

function applyUserAvatar(embed, user) {
  const avatarUrl = user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || user?.defaultAvatarURL || null;
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  const footerText = embed?.data?.footer?.text || `Date & Time: ${new Date().toLocaleString()}`;
  embed.setFooter({ text: footerText, iconURL: avatarUrl || undefined });
}

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      if (!newMember?.guild || newMember.user?.bot) return;

      const guild = newMember.guild;
      const addedRoles = newMember.roles.cache
        .filter(role => role.id !== guild.id && !oldMember.roles.cache.has(role.id));
      const removedRoles = oldMember.roles.cache
        .filter(role => role.id !== guild.id && !newMember.roles.cache.has(role.id));

      if (addedRoles.size) {
        const embed = buildMemberLogEmbed({
          action: 'Role Gained',
          user: newMember.user,
          color: GREEN,
          extraFields: [
            { name: 'Gained Role(s)', value: formatRoleLines(addedRoles.values()), inline: false },
          ],
        });
        await logSender.sendLog({
          guildId: guild.id,
          logType: 'member',
          embed,
          client: guild.client,
        });
      }

      if (removedRoles.size) {
        const embed = buildMemberLogEmbed({
          action: 'Role Lost',
          user: newMember.user,
          color: RED,
          extraFields: [
            { name: 'Lost Role(s)', value: formatRoleLines(removedRoles.values()), inline: false },
          ],
        });
        await logSender.sendLog({
          guildId: guild.id,
          logType: 'member',
          embed,
          client: guild.client,
        });
      }

      const oldNick = (oldMember.nickname || '').trim() || null;
      const newNick = (newMember.nickname || '').trim() || null;
      if (oldNick === newNick) return;

      const embed = buildLogEmbed({
        action: 'User Nickname Edited',
        target: newMember.user,
        actor: newMember.user,
        reason: `Nickname: ${oldNick || 'None'} -> ${newNick || 'None'}`,
        color: YELLOW,
        thumbnailTarget: newMember.user,
      });
      applyUserAvatar(embed, newMember.user);

      await logSender.sendLog({
        guildId: guild.id,
        logType: 'member',
        embed,
        client: guild.client,
      });
    } catch (err) {
      console.error('guildMemberUpdate.userLogs handler error:', err);
    }
  },
};
