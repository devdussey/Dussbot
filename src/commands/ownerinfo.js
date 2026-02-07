const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { isOwner, parseOwnerIds } = require('../utils/ownerIds');

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
  const lines = guildSummaries.map(({ name, id, ownerTag, ownerId, memberCount }) => {
    const ownerLabel = ownerTag || 'Unknown';
    const ownerIdentifier = ownerId || 'Unknown';
    const membersLabel = typeof memberCount === 'number'
      ? numberWithCommas(memberCount)
      : (memberCount ?? 'Unknown');
    return `${name} (${id}) — Owner: ${ownerLabel} (${ownerIdentifier}) — Members: ${membersLabel}`;
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

    const guildSummaries = await Promise.all(guilds.map(async guild => {
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

      return {
        name: guild.name,
        id: guild.id,
        ownerTag,
        ownerId,
        memberCount: typeof guild.memberCount === 'number' ? guild.memberCount : null,
      };
    }));

    const totalMembers = guildSummaries.reduce((sum, { memberCount }) => (
      sum + (typeof memberCount === 'number' ? memberCount : 0)
    ), 0);

    const embed = new EmbedBuilder()
      .setTitle('Owner Info')
      .setColor(resolveEmbedColour(interaction.guildId, 0x5b5bff))
      .addFields(
        { name: 'Servers', value: String(guilds.length), inline: true },
        { name: 'Total Members', value: numberWithCommas(totalMembers), inline: true },
        { name: 'Commands Loaded', value: String(client.commands?.size ?? 0), inline: true },
        { name: 'Owners', value: formatOwners(ownerIds, ownerUsers), inline: false },
        { name: 'Server Owners & Members', value: formatServerOwners(guildSummaries), inline: false },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
