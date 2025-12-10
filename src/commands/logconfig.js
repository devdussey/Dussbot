const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const streamLogStore = require('../utils/streamLogStore');

const CATEGORIES = {
  messages: 'Messages',
  invites: 'Invites',
  reactions: 'Reactions',
  roles: 'Roles',
  users: 'Members',
  server: 'Server',
  channels: 'Channels',
  bot: 'Bot',
  verification: 'Verification',
  security: 'Security',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logconfig')
    .setDescription('Configure all logging settings in one place')
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View all logging configuration and statuses')
    )
    .addSubcommand(sub =>
      sub
        .setName('setup-channels')
        .setDescription('Automatically create event log channels')
    )
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable a log category')
        .addStringOption(opt =>
          opt
            .setName('category')
            .setDescription('Log category to enable')
            .setRequired(true)
            .addChoices(...Object.entries(CATEGORIES).map(([k, v]) => ({ name: v, value: k })))
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable a log category')
        .addStringOption(opt =>
          opt
            .setName('category')
            .setDescription('Log category to disable')
            .setRequired(true)
            .addChoices(...Object.entries(CATEGORIES).map(([k, v]) => ({ name: v, value: k })))
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('Set the channel for a log category')
        .addStringOption(opt =>
          opt
            .setName('category')
            .setDescription('Log category')
            .setRequired(true)
            .addChoices(...Object.entries(CATEGORIES).map(([k, v]) => ({ name: v, value: k })))
        )
        .addChannelOption(opt =>
          opt
            .setName('target')
            .setDescription('Target text channel for logs')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'You need Manage Server permission.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const guild = interaction.guild;

    if (subcommand === 'view') {
      await handleView(interaction, guildId);
    } else if (subcommand === 'setup-channels') {
      await interaction.deferReply({ ephemeral: true });
      await handleSetupChannels(interaction, guild, guildId);
    } else if (subcommand === 'enable') {
      await interaction.deferReply({ ephemeral: true });
      await handleEnable(interaction, guildId);
    } else if (subcommand === 'disable') {
      await interaction.deferReply({ ephemeral: true });
      await handleDisable(interaction, guildId);
    } else if (subcommand === 'channel') {
      await interaction.deferReply({ ephemeral: true });
      await handleSetChannel(interaction, guildId);
    }
  },
};

async function handleView(interaction, guildId) {
  try {
    const eventChannels = await logChannelTypeStore.getAll(guildId);
    const streamStatus = await streamLogStore.listStatuses(guildId);

    const embed = new EmbedBuilder()
      .setTitle('📋 Logging Configuration')
      .setColor(0x3498db);

    // Event logs section
    const eventCount = Object.keys(eventChannels).length;
    if (eventCount === 0) {
      embed.addFields({ name: '📤 Event Logs (9 types)', value: 'Not configured. Use `/logconfig setup-channels`.' });
    } else {
      const eventList = Object.entries(eventChannels)
        .map(([type, id]) => `<#${id}> \`${type}\``)
        .join('\n');
      embed.addFields({ name: `📤 Event Logs (${eventCount}/9)`, value: eventList });
    }

    // Stream logs section
    const enabledCategories = Object.entries(streamStatus.categories)
      .filter(([_, enabled]) => enabled)
      .map(([cat, _]) => CATEGORIES[cat])
      .join(', ') || 'None';

    embed.addFields({ name: '🔄 Stream Logs (enabled)', value: enabledCategories || 'None enabled' });

    // Category details
    const categoryDetails = Object.entries(streamStatus.categories)
      .map(([cat, enabled]) => {
        const channel = streamStatus.categoryChannels[cat];
        const status = enabled ? '✅' : '❌';
        const channelStr = channel ? `<#${channel}>` : '(fallback)';
        return `${status} \`${CATEGORIES[cat]}\` ${channelStr}`;
      })
      .join('\n');

    embed.addFields({ name: 'Stream Log Categories', value: categoryDetails });

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error('View error:', err);
    await interaction.reply({ content: '❌ Failed to retrieve logging configuration.', ephemeral: true });
  }
}

async function handleSetupChannels(interaction, guild, guildId) {
  try {
    const logTypes = Object.entries(logChannelTypeStore.LOG_TYPES);
    const channels = {};
    let failed = 0;

    // Create or find log category
    let logCategory = guild.channels.cache.find(ch =>
      ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === 'logs'
    );

    if (!logCategory) {
      logCategory = await guild.channels.create({ name: 'Logs', type: ChannelType.GuildCategory }).catch(() => null);
    }

    // Create channels for each log type
    for (const [key, logType] of logTypes) {
      try {
        const channelName = `logs-${logType}`;
        let channel = guild.channels.cache.find(ch => ch.name === channelName && ch.type === ChannelType.GuildText);

        if (!channel) {
          channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: `Log channel for ${logType} events`,
            parent: logCategory?.id,
          });
        }

        await logChannelTypeStore.setChannel(guildId, logType, channel.id);
        channels[logType] = channel.id;
      } catch (err) {
        console.error(`Failed to create ${logType} log channel:`, err);
        failed++;
      }
    }

    const success = logTypes.length - failed;
    const embed = new EmbedBuilder()
      .setTitle('✅ Event Channels Setup Complete')
      .setColor(failed === 0 ? 0x00ff00 : 0xffaa00)
      .setDescription(`Created **${success}**/${logTypes.length} event log channels`)
      .addFields(
        { name: 'Channels', value: Object.entries(channels).map(([type, id]) => `<#${id}> \`${type}\``).join('\n') || 'None' }
      );

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Setup error:', err);
    await interaction.editReply({ content: '❌ Failed to setup logging channels.', ephemeral: true });
  }
}

async function handleEnable(interaction, guildId) {
  try {
    const category = interaction.options.getString('category');
    await streamLogStore.setEnabled(guildId, category, true);

    const embed = new EmbedBuilder()
      .setTitle('✅ Stream Log Enabled')
      .setColor(0x00ff00)
      .setDescription(`\`${CATEGORIES[category]}\` stream logs are now **enabled**.`);

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Enable error:', err);
    await interaction.editReply({ content: '❌ Failed to enable stream logs.', ephemeral: true });
  }
}

async function handleDisable(interaction, guildId) {
  try {
    const category = interaction.options.getString('category');
    await streamLogStore.setEnabled(guildId, category, false);

    const embed = new EmbedBuilder()
      .setTitle('✅ Stream Log Disabled')
      .setColor(0x00ff00)
      .setDescription(`\`${CATEGORIES[category]}\` stream logs are now **disabled**.`);

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Disable error:', err);
    await interaction.editReply({ content: '❌ Failed to disable stream logs.', ephemeral: true });
  }
}

async function handleSetChannel(interaction, guildId) {
  try {
    const category = interaction.options.getString('category');
    const channel = interaction.options.getChannel('target');

    await streamLogStore.setChannel(guildId, channel.id, category);

    const embed = new EmbedBuilder()
      .setTitle('✅ Stream Log Channel Set')
      .setColor(0x00ff00)
      .setDescription(`\`${CATEGORIES[category]}\` stream logs will now post to ${channel}.`);

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Set channel error:', err);
    await interaction.editReply({ content: '❌ Failed to set stream log channel.', ephemeral: true });
  }
}

