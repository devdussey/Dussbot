const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const logSender = require('../utils/logSender');
const {
  BOT_LOG_KEYS,
  BOT_LOG_KEY_LIST,
  BOT_ACTION_COLORS,
  buildBotLogEmbed,
} = require('../utils/botLogEmbed');

const STATUS_COLORS = {
  enable: 0x2ecc71,
  disable: 0xed4245,
  status: 0xffd166,
  test: 0x3498db,
};

const LABEL_BY_KEY = {
  [BOT_LOG_KEYS.group]: 'All bot events',
  [BOT_LOG_KEYS.join]: 'Bot joined',
  [BOT_LOG_KEYS.leave]: 'Bot left',
  [BOT_LOG_KEYS.messageCreate]: 'Bot message created',
  [BOT_LOG_KEYS.messageDelete]: 'Bot message deleted',
  [BOT_LOG_KEYS.messageEdit]: 'Bot message edited',
  [BOT_LOG_KEYS.moderation]: 'Bot moderation',
};

function formatEntry(key, entry) {
  const enabledText = entry?.enabled === false ? 'Disabled' : 'Enabled';
  const channelText = entry?.channelId ? `<#${entry.channelId}>` : 'No channel set';
  const label = LABEL_BY_KEY[key] || key.replace(/_/g, ' ');
  return `${label}: ${enabledText} — ${channelText}`;
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

function buildSummaryEmbed({ status, channel, entries, testResults }) {
  const embed = new EmbedBuilder()
    .setTitle('Bot Log Configuration')
    .setColor(STATUS_COLORS[status] || STATUS_COLORS.status)
    .setTimestamp(new Date())
    .addFields(
      { name: 'Action', value: status.charAt(0).toUpperCase() + status.slice(1), inline: true },
      { name: 'Channel', value: channel ? `${channel}` : 'Unchanged / per-entry', inline: true },
    );

  const lines = BOT_LOG_KEY_LIST.map(key => formatEntry(key, entries[key]));
  embed.addFields({ name: 'Routes', value: lines.join('\n').slice(0, 1024) || 'No entries found.', inline: false });

  if (testResults?.length) {
    const testLine = testResults
      .map(res => `${res.ok ? '✅' : '❌'} ${res.label}${res.error ? ` — ${res.error}` : ''}`)
      .join('\n')
      .slice(0, 1024);
    embed.addFields({ name: 'Test send', value: testLine, inline: false });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botlogconfig')
    .setDescription('Configure bot activity logging (join/leave/messages/mod actions)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption(option =>
      option
        .setName('config')
        .setDescription('Enable, disable, view status, or send a test log')
        .setRequired(true)
        .addChoices(
          { name: 'enable', value: 'enable' },
          { name: 'disable', value: 'disable' },
          { name: 'status', value: 'status' },
          { name: 'test', value: 'test' },
        ))
    .addChannelOption(option =>
      option
        .setName('channel_id')
        .setDescription('Channel to send bot activity logs')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure bot logs.', ephemeral: true });
    }

    const status = interaction.options.getString('config', true);
    const channel = interaction.options.getChannel('channel_id', false);
    const isTest = status === 'test';
    const shouldEnable = status === 'enable' || isTest;

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
      for (const key of BOT_LOG_KEY_LIST) {
        // eslint-disable-next-line no-await-in-loop
        currentEntries[key] = await logChannelTypeStore.getEntry(guild.id, key);
      }

      const needsChannel = shouldEnable
        && !channel
        && BOT_LOG_KEY_LIST.some(key => !currentEntries[key]?.channelId);

      if (needsChannel) {
        return interaction.editReply({
          content: 'Please choose a channel ID to enable or test bot logs.',
        });
      }

      if (status !== 'status') {
        for (const key of BOT_LOG_KEY_LIST) {
          if (shouldEnable) {
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

      const entries = {};
      for (const key of BOT_LOG_KEY_LIST) {
        // eslint-disable-next-line no-await-in-loop
        entries[key] = await logChannelTypeStore.getEntry(guild.id, key);
      }

      let testResults = null;
      if (isTest) {
        testResults = [];
        const botUser = interaction.client.user;
        const resolvedChannelId = channel?.id
          || entries[BOT_LOG_KEYS.group]?.channelId
          || entries[BOT_LOG_KEYS.join]?.channelId
          || null;

        const scenarios = [
          { key: BOT_LOG_KEYS.join, label: 'Joined', color: BOT_ACTION_COLORS.join, inviter: interaction.user },
          { key: BOT_LOG_KEYS.messageCreate, label: 'Message Created', color: BOT_ACTION_COLORS.messageCreate },
          { key: BOT_LOG_KEYS.moderation, label: 'Moderator Action', color: BOT_ACTION_COLORS.moderation, actor: interaction.user },
        ];

        for (const scenario of scenarios) {
          const embed = buildBotLogEmbed({
            action: `${scenario.label} (test)`,
            botUser,
            channel: resolvedChannelId ? `<#${resolvedChannelId}>` : null,
            inviter: scenario.inviter || null,
            actor: scenario.actor || null,
            color: scenario.color,
            description: 'Test dispatch to confirm bot log routing.',
            extraFields: [
              { name: 'Route', value: LABEL_BY_KEY[scenario.key] || scenario.key, inline: true },
            ],
          });
          try {
            // eslint-disable-next-line no-await-in-loop
            const sent = await logSender.sendLog({
              guildId: guild.id,
              logType: scenario.key,
              embed,
              client: interaction.client,
            });
            testResults.push({ label: scenario.label, ok: Boolean(sent) });
          } catch (err) {
            testResults.push({ label: scenario.label, ok: false, error: err?.message || 'Unknown error' });
          }
        }
      }

      const summaryEmbed = buildSummaryEmbed({
        status,
        channel,
        entries,
        testResults,
      });

      return interaction.editReply({ embeds: [summaryEmbed] });
    } catch (err) {
      console.error('Failed to update bot log config:', err);
      return interaction.editReply({ content: 'Failed to update bot log configuration. Please try again later.' });
    }
  },
};
