const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { isOwner, parseOwnerIds } = require('../utils/ownerIds');
const MEMBER_PREVIEW_LIMIT = 5;

function formatOwners(ownerIds, ownerUsers) {
  if (!ownerIds.length) return 'No owner IDs configured.';
  return ownerIds.map((id, index) => {
    const user = ownerUsers[index];
    if (user) return `${user.tag} (${id})`;
    return `Unknown (${id})`;
  }).join('\n');
}

function formatServerOwners(guildSummaries) {
  if (!guildSummaries.length) return 'No servers found.';
  const lines = guildSummaries.map(({ name, id, ownerTag, ownerId, memberCount, memberPreview, extraPreview }) => {
    const ownerLabel = ownerTag || 'Unknown';
    const ownerIdentifier = ownerId || 'Unknown';
    const membersLabel = typeof memberCount === 'number'
      ? numberWithCommas(memberCount)
      : (memberCount ?? 'Unknown');
    let line = `${name} (${id}) — Owner: ${ownerLabel} (${ownerIdentifier}) — Members: ${membersLabel}`;
    if (memberPreview.length) {
      const extraText = extraPreview > 0 ? `, +${extraPreview} more` : '';
      line += `\nMembers preview: ${memberPreview.join(', ')}${extraText}`;
    } else if (typeof memberCount === 'number' && memberCount > 0) {
      line += '\nMember preview: not cached';
    }
    return line;
  });

  let value = '';
  let remaining = lines.length;

  for (const line of lines) {
    const next = value ? `${value}\n${line}` : line;
    if (next.length > 1000) break;
    value = next;
    remaining -= 1;
  }

  if (remaining > 0) {
    value = `${value}\n...and ${remaining} more`;
  }

  return value;
}

function numberWithCommas(value) {
  return value.toLocaleString?.() ?? String(value);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ownerinfo')
    .setDescription('Bot owner: show servers, owners, and command count'),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: 'This command is restricted to bot owners.', ephemeral: true });
    }

    const client = interaction.client;
    const guilds = [...client.guilds.cache.values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    const excludedGuildId = process.env.GUILD_ID?.trim() || null;
    const visibleGuilds = excludedGuildId
      ? guilds.filter(guild => guild.id !== excludedGuildId)
      : guilds;
    const excludedGuild = excludedGuildId
      ? guilds.find(guild => guild.id === excludedGuildId) ?? null
      : null;
    const ownerIds = parseOwnerIds();
    const ownerUsers = [];

    for (const ownerId of ownerIds) {
      try {
        const user = await client.users.fetch(ownerId);
        ownerUsers.push(user);
      } catch (error) {
        ownerUsers.push(null);
      }
    }

    const guildSummaries = await Promise.all(visibleGuilds.map(async guild => {
      const ownerIdFallback = guild.ownerId ?? 'Unknown';
      let ownerTag = 'Unknown';
      let ownerId = ownerIdFallback;

      if (guild.ownerId) {
        try {
          const owner = await guild.fetchOwner();
          ownerTag = owner.user?.tag ?? ownerTag;
          ownerId = owner.user?.id ?? ownerId;
        } catch {
          ownerTag = 'Unknown';
        }
      }

      const cachedMembers = [...guild.members.cache.values()];
      const memberPreviewUsers = cachedMembers
        .filter(member => member.user && !member.user.bot)
        .slice(0, MEMBER_PREVIEW_LIMIT)
        .map(member => member.user);
      const memberPreview = memberPreviewUsers.map(user => `${user.tag} (${user.id})`);
      const estimatedMemberCount = typeof guild.memberCount === 'number'
        ? guild.memberCount
        : cachedMembers.length;

      return {
        name: guild.name,
        id: guild.id,
        ownerTag,
        ownerId,
        memberCount: typeof guild.memberCount === 'number' ? guild.memberCount : estimatedMemberCount,
        memberPreview,
        extraPreview: Math.max(0, estimatedMemberCount - memberPreview.length),
      };
    }));

    const totalMembers = guildSummaries.reduce((sum, { memberCount }) => (
      sum + (typeof memberCount === 'number' ? memberCount : 0)
    ), 0);

    const embedFields = [
      { name: 'Servers', value: String(visibleGuilds.length), inline: true },
      { name: 'Total Members', value: numberWithCommas(totalMembers), inline: true },
      { name: 'Commands Loaded', value: String(client.commands?.size ?? 0), inline: true },
    ];

    if (excludedGuild) {
      embedFields.push({
        name: 'Excluded Server',
        value: `${excludedGuild.name} (${excludedGuild.id})`,
        inline: true,
      });
    } else if (excludedGuildId) {
      embedFields.push({
        name: 'Excluded Server',
        value: 'Configured but not cached',
        inline: true,
      });
    }

    embedFields.push(
      { name: 'Owners', value: formatOwners(ownerIds, ownerUsers), inline: false },
      { name: 'Server Owners & Members', value: formatServerOwners(guildSummaries), inline: false },
    );

    const embed = new EmbedBuilder()
      .setTitle('Owner Info')
      .setColor(resolveEmbedColour(interaction.guildId, 0x5b5bff))
      .addFields(embedFields)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
