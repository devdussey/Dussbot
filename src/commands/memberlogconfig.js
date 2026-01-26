const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const logSender = require('../utils/logSender');

const GROUP_KEY = 'member';
const ACTIONS = {
  joined: { key: 'member_join', label: 'Member Joined', color: 0x2ecc71 },
  leave: { key: 'member_leave', label: 'Member Left', color: 0xed4245 },
  boosted: { key: 'member_boost', label: 'Member Boosted', color: 0xeb459e },
};

const STATUS_COLORS = {
  enable: 0x2ecc71,
  disable: 0xed4245,
  status: 0xffd166,
  test: 0x3498db,
};

function formatEntry(entry) {
  const enabledText = entry?.enabled === false ? 'Disabled' : 'Enabled';
  const channelText = entry?.channelId ? `<#${entry.channelId}>` : 'No channel set';
  return `${enabledText} — ${channelText}`;
}

function formatTestResults(results) {
  if (!results?.length) return 'No tests were run.';
  return results
    .map(result => `${result.ok ? '✅' : '❌'} ${result.label}${result.error ? ` — ${result.error}` : ''}`)
    .join('\n')
    .slice(0, 1024);
}

function buildTestEmbed({ label, color, user }) {
  const now = new Date();
  const embed = new EmbedBuilder()
    .setTitle('Member Log Test')
    .setColor(color)
    .setTimestamp(now)
    .addFields(
      { name: 'Action', value: label, inline: true },
      { name: 'User', value: `${user.tag || user.username || user.id} (${user.id})`, inline: true },
    )
    .setFooter({ text: `Date & time of action: ${now.toLocaleString()}` });

  const avatar = typeof user.displayAvatarURL === 'function'
    ? user.displayAvatarURL({ size: 256 })
    : null;
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}

function buildSummaryEmbed({ status, scopeLabel, channel, entries, testResults }) {
  const embed = new EmbedBuilder()
    .setTitle('Member Log Configuration')
    .setDescription('Private confirmation of your member log settings.')
    .setColor(STATUS_COLORS[status] || STATUS_COLORS.status)
    .setTimestamp(new Date())
    .addFields(
      { name: 'Action', value: status === 'status' ? 'Status' : status.charAt(0).toUpperCase() + status.slice(1), inline: true },
      { name: 'Events', value: scopeLabel, inline: true },
      { name: 'Channel', value: channel ? `${channel}` : 'Not provided', inline: true },
    );

  for (const [label, entry] of entries) {
    embed.addFields({ name: label, value: formatEntry(entry), inline: false });
  }

  if (testResults) {
    embed.addFields({ name: 'Test send', value: formatTestResults(testResults), inline: false });
  }

  return embed;
}

async function ensureChannelUsable(channel, guild) {
  const isForum = channel.type === ChannelType.GuildForum;
  if (!channel.isTextBased?.() && !isForum) {
    return 'Please choose a text, announcement, or forum channel.';
  }

  const me = guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null);
  if (!me) return null;

  const required = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.EmbedLinks,
  ];

  if (isForum) {
    required.push(
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.SendMessagesInThreads,
    );
  } else if (typeof channel.isThread === 'function' ? channel.isThread() : Boolean(channel.isThread)) {
    required.push(PermissionsBitField.Flags.SendMessagesInThreads);
  } else {
    required.push(PermissionsBitField.Flags.SendMessages);
  }

  const perms = channel.permissionsFor(me);
  if (!perms || !perms.has(required)) {
    const missing = required
      .filter(flag => !perms?.has(flag))
      .map(flag => Object.entries(PermissionsBitField.Flags).find(([, v]) => v === flag)?.[0] || String(flag));
    return `I need ${missing.join(', ')} permissions in ${channel} to post logs.`;
  }

  return null;
}

function resolveKeys(scope) {
  if (scope === 'all') return [GROUP_KEY, ...Object.values(ACTIONS).map(a => a.key)];
  const action = ACTIONS[scope];
  return action ? [action.key] : [];
}

function labelForKey(key) {
  if (key === GROUP_KEY) return 'All member events';
  const action = Object.values(ACTIONS).find(a => a.key === key);
  return action ? action.label : key.replace(/_/g, ' ').toUpperCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('memberlogconfig')
    .setDescription('Configure join/leave/boost member logs')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption(option =>
      option
        .setName('configuration')
        .setDescription('Enable, disable, view status, or send a test log')
        .setRequired(true)
        .addChoices(
          { name: 'enable', value: 'enable' },
          { name: 'disable', value: 'disable' },
          { name: 'status', value: 'status' },
          { name: 'test send', value: 'test' },
        ))
    .addStringOption(option =>
      option
        .setName('actions')
        .setDescription('Which member actions to target')
        .setRequired(true)
        .addChoices(
          { name: 'joined (green embed)', value: 'joined' },
          { name: 'left (red embed)', value: 'leave' },
          { name: 'boosted (purple embed)', value: 'boosted' },
          { name: 'all member actions', value: 'all' },
        ))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send the selected member logs')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure member logs.', ephemeral: true });
    }

    const status = interaction.options.getString('configuration', true);
    const scope = interaction.options.getString('actions', true);
    const channel = interaction.options.getChannel('channel', false);
    const keys = resolveKeys(scope);

    if (!keys.length) {
      return interaction.reply({ content: 'Unknown action selection.', ephemeral: true });
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'Could not resolve this server. Please try again.', ephemeral: true });
    }

    if (channel) {
      const channelError = await ensureChannelUsable(channel, guild);
      if (channelError) {
        return interaction.reply({ content: channelError, ephemeral: true });
      }
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const currentEntries = {};
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        currentEntries[key] = await logChannelTypeStore.getEntry(guild.id, key);
      }

      const needsChannel = (status === 'enable' || status === 'test')
        && !channel
        && keys.some(key => !currentEntries[key]?.channelId);

      if (needsChannel) {
        return interaction.editReply({
          content: 'Please choose a channel to enable or test member logs.',
        });
      }

      if (status !== 'status') {
        for (const key of keys) {
          if (status === 'enable' || status === 'test') {
            if (channel) {
              // eslint-disable-next-line no-await-in-loop
              await logChannelTypeStore.setChannel(guild.id, key, channel.id);
            }
            // eslint-disable-next-line no-await-in-loop
            await logChannelTypeStore.setEnabled(guild.id, key, true);
          } else if (status === 'disable') {
            // eslint-disable-next-line no-await-in-loop
            await logChannelTypeStore.setEnabled(guild.id, key, false);
          }
        }
      }

      const entries = [];
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        const entry = await logChannelTypeStore.getEntry(guild.id, key);
        entries.push([labelForKey(key), entry]);
      }

      let testResults = null;
      if (status === 'test') {
        testResults = [];
        const targets = keys.filter(k => k !== GROUP_KEY);
        for (const key of targets) {
          const action = Object.values(ACTIONS).find(a => a.key === key);
          if (!action) continue;
          try {
            // eslint-disable-next-line no-await-in-loop
            const sent = await logSender.sendLog({
              guildId: guild.id,
              logType: key,
              embed: buildTestEmbed({ label: action.label, color: action.color, user: interaction.user }),
              client: interaction.client,
            });
            testResults.push({ key, label: action.label, ok: Boolean(sent) });
          } catch (err) {
            testResults.push({ key, label: action.label, ok: false, error: err?.message || 'Unknown error' });
          }
        }
      }

      const scopeLabel = scope === 'all'
        ? 'All member actions'
        : (ACTIONS[scope]?.label || scope);

      const summaryEmbed = buildSummaryEmbed({
        status,
        scopeLabel,
        channel,
        entries,
        testResults,
      });

      return interaction.editReply({ embeds: [summaryEmbed] });
    } catch (err) {
      console.error('Failed to update member log config:', err);
      return interaction.editReply({ content: 'Failed to update member log configuration. Please try again later.' });
    }
  },
};
