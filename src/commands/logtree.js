const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const { listCategories, listKeysForCategory, getLogKeyLabel } = require('../utils/logEvents');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { isMysqlConfigured } = require('../utils/mysqlPool');

function isEnabledWithChannel(entry) {
  return Boolean(entry?.channelId) && entry?.enabled !== false;
}

function formatKeyLine(logKey, entry) {
  const label = getLogKeyLabel(logKey);
  const channel = entry?.channelId ? `<#${entry.channelId}>` : null;
  const status = entry?.enabled === false ? '❌' : (channel ? '✅' : '❌');
  if (entry?.enabled === false) return `${status} ${label}${channel ? ` — ${channel}` : ''}`;
  return `${status} ${label}${channel ? ` — ${channel}` : ''}`;
}

function buildFieldValue(lines, emptyMessage) {
  if (!lines.length) return emptyMessage;
  const out = [];
  let total = 0;
  for (const line of lines) {
    // +1 for newline that will be added when joining.
    if (total && (total + 1 + line.length) > 1024) {
      out.push(`… (+${lines.length - out.length} more)`);
      break;
    }
    out.push(line);
    total += (total ? 1 : 0) + line.length;
  }
  return out.join('\n').slice(0, 1024) || emptyMessage;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logtree')
    .setDescription('Admin-only: view the current log setup')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to view the log setup.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const entries = await logChannelTypeStore.getAll(interaction.guildId);
      const categories = listCategories();

      const configuredKeys = Object.entries(entries || {}).filter(([, entry]) => entry?.channelId || entry?.enabled === false).length;

      const embed = new EmbedBuilder()
        .setTitle('Log setup')
        .setDescription([
          `Storage: **${isMysqlConfigured() ? 'MySQL' : 'Local JSON'}**`,
          `Configured routes: **${configuredKeys}**`,
          '✅ = enabled (has a channel) · ❌ = disabled/unconfigured',
          'Use `/logconfig` to change routing.',
        ].join('\n'))
        .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
        .setTimestamp(new Date());

      for (const category of categories) {
        const keys = listKeysForCategory(category);
        const categoryEnabled = keys.some(key => isEnabledWithChannel(entries?.[key]));
        const notableKeys = keys.filter(key => entries?.[key]?.channelId || entries?.[key]?.enabled === false);

        const lines = notableKeys.map(key => formatKeyLine(key, entries?.[key]));
        const value = buildFieldValue(lines, 'No routes configured.');

        embed.addFields({
          name: `${categoryEnabled ? '✅' : '❌'} ${category}`,
          value,
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to build log tree view:', err);
      return interaction.editReply({ content: 'Failed to load the log setup. Please try again later.' });
    }
  },
};

