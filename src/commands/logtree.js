const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const { listCategories, listKeysForCategory, getLogKeyLabel } = require('../utils/logEvents');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { isMysqlConfigured } = require('../utils/mysqlPool');

const PERM_NAME_BY_VALUE = new Map(Object.entries(PermissionsBitField.Flags).map(([name, value]) => [value, name]));
function permName(value) {
  return PERM_NAME_BY_VALUE.get(value) || String(value);
}

function requiredPermissionsForChannel(channel) {
  const base = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.EmbedLinks,
  ];
  const isThread = typeof channel?.isThread === 'function' ? channel.isThread() : Boolean(channel?.isThread);
  if (channel?.type === ChannelType.GuildForum) {
    return [
      ...base,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.SendMessagesInThreads,
    ];
  }
  return [...base, isThread ? PermissionsBitField.Flags.SendMessagesInThreads : PermissionsBitField.Flags.SendMessages];
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

async function describeRoute(guild, me, getChannel, logKey, entry) {
  const label = getLogKeyLabel(logKey);
  const channelId = entry?.channelId ? String(entry.channelId) : null;

  if (entry?.enabled === false) {
    return { ok: false, line: `❌ ${label} (disabled)` };
  }
  if (!channelId) {
    return { ok: false, line: `❌ ${label} (no channel)` };
  }

  const channel = await getChannel(channelId);
  if (!channel) {
    return { ok: false, line: `❌ ${label} — <#${channelId}> (no access)` };
  }
  if (!channel.isTextBased?.() && channel.type !== ChannelType.GuildForum) {
    return { ok: false, line: `❌ ${label} — <#${channelId}> (not text)` };
  }

  if (me) {
    const required = requiredPermissionsForChannel(channel);
    const perms = channel.permissionsFor(me);
    const missing = required.filter(flag => !perms?.has(flag)).map(permName);
    if (missing.length) {
      const short = missing.slice(0, 3).join(', ') + (missing.length > 3 ? ` (+${missing.length - 3})` : '');
      return { ok: false, line: `❌ ${label} — <#${channelId}> (missing ${short})` };
    }
  }

  return { ok: true, line: `✅ ${label} — <#${channelId}>` };
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
      const guild = interaction.guild;
      if (!guild) {
        return interaction.editReply({ content: 'Could not resolve this server. Please try again.' });
      }

      const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
      const channelCache = new Map();
      const getChannel = async (channelId) => {
        if (channelCache.has(channelId)) return channelCache.get(channelId);
        const fetched = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        channelCache.set(channelId, fetched || null);
        return fetched || null;
      };

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
        const notableKeys = keys.filter(key => entries?.[key]?.channelId || entries?.[key]?.enabled === false);

        const routes = [];
        for (const key of notableKeys) {
          routes.push(await describeRoute(guild, me, getChannel, key, entries?.[key]));
        }

        const categoryEnabled = routes.some(route => route.ok);
        const lines = routes.map(route => route.line);
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
