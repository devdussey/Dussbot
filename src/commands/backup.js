const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { isOwner } = require('../utils/ownerIds');
const backupStore = require('../utils/backupStore');
const securityLogger = require('../utils/securityLogger');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function serializeBan(ban) {
  if (!ban?.user) return null;
  return {
    userId: ban.user.id,
    tag: typeof ban.user.tag === 'string' ? ban.user.tag : null,
    reason: ban.reason || null,
  };
}

function serializeOverwrite(overwrite) {
  if (!overwrite) return null;
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow?.bitfield?.toString?.() || null,
    deny: overwrite.deny?.bitfield?.toString?.() || null,
  };
}

function serializeChannel(channel) {
  if (!channel) return null;
  const data = {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    kind: channel.constructor?.name || null,
    parentId: channel.parentId ?? null,
    position: Number.isFinite(channel.rawPosition) ? channel.rawPosition : null,
  };
  if (typeof channel.topic === 'string') data.topic = channel.topic;
  if (typeof channel.nsfw === 'boolean') data.nsfw = channel.nsfw;
  if (typeof channel.rateLimitPerUser === 'number') data.rateLimitPerUser = channel.rateLimitPerUser;
  if (typeof channel.bitrate === 'number') data.bitrate = channel.bitrate;
  if (typeof channel.userLimit === 'number') data.userLimit = channel.userLimit;
  if (typeof channel.rtcRegion !== 'undefined') data.rtcRegion = channel.rtcRegion || null;
  if (channel.permissionOverwrites?.cache) {
    data.permissionOverwrites = channel.permissionOverwrites.cache
      .map(serializeOverwrite)
      .filter(Boolean);
  }
  return data;
}

function serializeRole(role) {
  if (!role) return null;
  const tags = role.tags;
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    hexColor: role.hexColor || null,
    position: role.position,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    permissions: role.permissions?.bitfield?.toString?.() || null,
    unicodeEmoji: role.unicodeEmoji || null,
    icon: role.icon || null,
    tags: tags
      ? {
        botId: tags.botId || null,
        integrationId: tags.integrationId || null,
        premiumSubscriberRole: tags.premiumSubscriberRole || null,
      }
      : null,
  };
}

function serializeBotMember(member) {
  if (!member?.user) return null;
  return {
    id: member.user.id,
    tag: member.user.tag || null,
    nickname: member.nickname || null,
    roles: member.roles?.cache ? member.roles.cache.map(role => role.id) : [],
    joinedAt: Number.isFinite(member.joinedTimestamp) ? member.joinedTimestamp : null,
    createdAt: Number.isFinite(member.user.createdTimestamp) ? member.user.createdTimestamp : null,
  };
}

function buildBotInfo(client) {
  const user = client.user;
  return {
    id: user?.id || null,
    tag: user?.tag || null,
    username: user?.username || null,
    createdAt: Number.isFinite(user?.createdTimestamp) ? user.createdTimestamp : null,
    applicationId: client.application?.id || process.env.CLIENT_ID || null,
    commandCount: Number.isFinite(client.commands?.size) ? client.commands.size : null,
    uptimeSeconds: Number.isFinite(process.uptime()) ? Math.floor(process.uptime()) : null,
    nodeEnv: process.env.NODE_ENV || null,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Owner-only: snapshot bans, channels, roles, and bot info for this server'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!isOwner(interaction.user.id)) {
      try { await securityLogger.logPermissionDenied(interaction, 'backup', 'User is not a bot owner'); } catch (_) {}
      return interaction.reply({ content: 'This command is restricted to bot owners.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const me = guild.members.me;
    const warnings = [];

    const snapshot = {
      capturedAt: Date.now(),
      capturedBy: {
        id: interaction.user.id,
        tag: interaction.user.tag,
      },
      guild: {
        id: guild.id,
        name: guild.name,
        ownerId: guild.ownerId || null,
        memberCount: guild.memberCount ?? null,
        createdAt: Number.isFinite(guild.createdTimestamp) ? guild.createdTimestamp : null,
        preferredLocale: guild.preferredLocale || null,
        features: Array.isArray(guild.features) ? guild.features.slice() : [],
        description: guild.description || null,
        iconURL: typeof guild.iconURL === 'function' ? guild.iconURL({ size: 256 }) : null,
        bannerURL: typeof guild.bannerURL === 'function' ? guild.bannerURL({ size: 256 }) : null,
      },
      botInfo: buildBotInfo(interaction.client),
    };

    let banItems = [];
    let bansFetchedAt = null;
    if (!me?.permissions?.has(PermissionsBitField.Flags.BanMembers)) {
      warnings.push('Missing Ban Members permission: ban list not captured.');
    } else {
      try {
        const bans = await guild.bans.fetch();
        bansFetchedAt = Date.now();
        banItems = bans.map(serializeBan).filter(Boolean);
      } catch (err) {
        warnings.push(`Failed to fetch bans: ${err?.message || 'Unknown error'}`);
      }
    }
    snapshot.bans = {
      fetchedAt: bansFetchedAt,
      count: banItems.length,
      items: banItems,
    };

    let channelItems = [];
    let channelsFetchedAt = null;
    let channelsPartial = false;
    try {
      const channels = await guild.channels.fetch();
      channelsFetchedAt = Date.now();
      channelItems = Array.from(channels.values())
        .map(serializeChannel)
        .filter(Boolean)
        .sort((a, b) => (a.position || 0) - (b.position || 0));
    } catch (err) {
      channelsPartial = true;
      warnings.push(`Failed to fetch channels: ${err?.message || 'Unknown error'}`);
      channelsFetchedAt = Date.now();
      channelItems = Array.from(guild.channels.cache.values())
        .map(serializeChannel)
        .filter(Boolean)
        .sort((a, b) => (a.position || 0) - (b.position || 0));
    }
    snapshot.channels = {
      fetchedAt: channelsFetchedAt,
      count: channelItems.length,
      partial: channelsPartial,
      items: channelItems,
    };

    let roleItems = [];
    let rolesFetchedAt = null;
    let rolesPartial = false;
    try {
      const roles = await guild.roles.fetch();
      rolesFetchedAt = Date.now();
      roleItems = Array.from(roles.values())
        .map(serializeRole)
        .filter(Boolean)
        .sort((a, b) => (a.position || 0) - (b.position || 0));
    } catch (err) {
      rolesPartial = true;
      warnings.push(`Failed to fetch roles: ${err?.message || 'Unknown error'}`);
      rolesFetchedAt = Date.now();
      roleItems = Array.from(guild.roles.cache.values())
        .map(serializeRole)
        .filter(Boolean)
        .sort((a, b) => (a.position || 0) - (b.position || 0));
    }
    snapshot.roles = {
      fetchedAt: rolesFetchedAt,
      count: roleItems.length,
      partial: rolesPartial,
      items: roleItems,
    };

    let botItems = [];
    let botsFetchedAt = null;
    let botsPartial = false;
    try {
      const members = await guild.members.fetch();
      botsFetchedAt = Date.now();
      botItems = members.filter(member => member.user?.bot).map(serializeBotMember).filter(Boolean);
    } catch (err) {
      botsPartial = true;
      warnings.push(`Failed to fetch all members for bot list: ${err?.message || 'Unknown error'}`);
      botsFetchedAt = Date.now();
      botItems = guild.members.cache.filter(member => member.user?.bot).map(serializeBotMember).filter(Boolean);
    }
    snapshot.bots = {
      fetchedAt: botsFetchedAt,
      count: botItems.length,
      partial: botsPartial,
      items: botItems,
    };

    const stored = backupStore.createBackup(guild.id, {
      guildName: guild.name,
      createdBy: { id: interaction.user.id, tag: interaction.user.tag },
      snapshot,
      warnings,
    });

    const embed = new EmbedBuilder()
      .setTitle(`Backup #${stored.id} saved`)
      .setColor(resolveEmbedColour(interaction.guildId, 0x2ecc71))
      .setDescription(`Snapshot stored for **${guild.name}**.`)
      .addFields(
        { name: 'Bans', value: String(snapshot.bans.count), inline: true },
        { name: 'Channels', value: String(snapshot.channels.count), inline: true },
        { name: 'Roles', value: String(snapshot.roles.count), inline: true },
        { name: 'Bots', value: String(snapshot.bots.count), inline: true },
      )
      .setTimestamp(new Date());

    if (warnings.length) {
      embed.addFields({ name: 'Warnings', value: warnings.slice(0, 5).join('\n') });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
