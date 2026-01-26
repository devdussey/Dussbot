const { Events, PermissionsBitField } = require('discord.js');
const boosterStore = require('../utils/boosterRoleStore');
const boosterManager = require('../utils/boosterRoleManager');
const boosterConfigStore = require('../utils/boosterRoleConfigStore');
const { postBoosterRolePanel } = require('../utils/boosterRolePanel');
const logSender = require('../utils/logSender');
const { buildMemberLogEmbed } = require('../utils/memberLogEmbed');

async function getMe(guild) {
  if (!guild) return null;
  const me = guild.members.me;
  if (me) return me;
  try { return await guild.members.fetchMe(); } catch (_) { return null; }
}

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      if (!newMember?.guild) return;
      const guild = newMember.guild;

      const enabled = await boosterConfigStore.isEnabled(guild.id);
      if (!enabled) return;

      const hadBoost = Boolean(oldMember?.premiumSinceTimestamp || oldMember?.premiumSince);
      const hasBoost = Boolean(newMember?.premiumSinceTimestamp || newMember?.premiumSince);

      if (hasBoost && !hadBoost) {
        try {
          const timestamp = newMember?.premiumSinceTimestamp || Date.now();
          const embed = buildMemberLogEmbed({
            action: 'User Boosted',
            user: newMember.user || { id: newMember.id },
            color: 0xeb459e,
            extraFields: [
              { name: 'Guild', value: `${guild.name} (${guild.id})`, inline: true },
              { name: 'Boost start', value: `<t:${Math.floor(timestamp / 1000)}:f>`, inline: true },
            ],
          });
          await logSender.sendLog({
            guildId: guild.id,
            logType: 'member_boost',
            embed,
            client: guild.client,
          });
        } catch (err) {
          console.error(`Failed to log member boost for ${newMember.id} in ${guild.id}:`, err);
        }

        try {
          await boosterManager.ensureRole(newMember, { createIfMissing: true });
        } catch (err) {
          console.error(`Failed to ensure booster role for ${newMember.id} in ${guild.id}:`, err);
        }
        try {
          const panel = await boosterConfigStore.getPanel(guild.id);
          if (panel?.channelId) {
            let channel = null;
            try { channel = await guild.channels.fetch(panel.channelId); } catch (_) {}
            if (channel?.isTextBased?.()) {
              const me = await getMe(guild);
              const perms = channel.permissionsFor(me);
              if (perms?.has(PermissionsBitField.Flags.ViewChannel) && perms?.has(PermissionsBitField.Flags.SendMessages)) {
                try {
                  await channel.send({ content: `<@${newMember.id}> thanks for boosting! Use the panel below to customise your booster role.` });
                } catch (err) {
                  console.warn(`Failed to announce booster ${newMember.id} in ${guild.id}:`, err);
                }
                try {
                  const sent = await postBoosterRolePanel(channel, panel.messageId);
                  await boosterConfigStore.setPanel(guild.id, channel.id, sent.id);
                } catch (err) {
                  console.warn(`Failed to refresh booster panel for ${guild.id}:`, err);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to handle booster announcement for ${newMember.id} in ${guild.id}:`, err);
        }
        return;
      }

      if (!hasBoost && hadBoost) {
        const roleId = await boosterStore.getRoleId(guild.id, newMember.id);
        let role = null;
        if (roleId) {
          try { role = await guild.roles.fetch(roleId); } catch (_) { role = null; }
        }
        const me = await getMe(guild);
        const canManageRole = role && me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)
          && me.roles?.highest?.comparePositionTo(role) > 0;

        if (role && canManageRole) {
          try {
            if (newMember.roles?.cache?.has(role.id)) {
              await newMember.roles.remove(role, 'Booster removed their boost');
            }
          } catch (err) {
            console.warn(`Failed to remove booster role from ${newMember.id}:`, err);
          }

          try {
            await role.delete('Booster removed their boost');
          } catch (err) {
            console.warn(`Failed to delete booster role ${role.id} in ${guild.id}:`, err);
          }
        }

        try {
          await boosterManager.cleanupLegacyRoles(newMember, null);
        } catch (err) {
          console.warn(`Failed to clean legacy booster roles for ${newMember.id}:`, err);
        }

        await boosterStore.deleteRole(guild.id, newMember.id);
      }
    } catch (err) {
      console.error('Failed handling booster role update:', err);
    }
  },
};
