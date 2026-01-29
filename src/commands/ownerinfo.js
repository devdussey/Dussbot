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

function formatServers(guilds) {
  if (!guilds.length) return 'No servers found.';
  const lines = guilds.map(guild => `${guild.name} (${guild.id})`);
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

    const embed = new EmbedBuilder()
      .setTitle('Owner Info')
      .setColor(resolveEmbedColour(interaction.guildId, 0x5b5bff))
      .addFields(
        { name: 'Servers', value: String(guilds.length), inline: true },
        { name: 'Commands Loaded', value: String(client.commands?.size ?? 0), inline: true },
        { name: 'Owners', value: formatOwners(ownerIds, ownerUsers), inline: false },
        { name: 'Server List', value: formatServers(guilds), inline: false },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
