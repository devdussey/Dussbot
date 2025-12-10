const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logconfig')
    .setDescription('Configure logging and automatically create log channels')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Automatically create log channels for each log type')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('View current logging configuration')
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a specific log channel')
        .addStringOption(opt =>
          opt
            .setName('log_type')
            .setDescription('Which log type to remove')
            .setRequired(true)
            .addChoices(
              { name: 'Moderation', value: 'moderation' },
              { name: 'Security', value: 'security' },
              { name: 'Messages', value: 'message' },
              { name: 'Members', value: 'member' },
              { name: 'Roles', value: 'role' },
              { name: 'Channels', value: 'channel' },
              { name: 'Server', value: 'server' },
              { name: 'Verification', value: 'verification' },
              { name: 'Invites', value: 'invite' },
            )
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

    if (subcommand === 'setup') {
      await interaction.deferReply({ ephemeral: true });
      await handleSetup(interaction, guild, guildId);
    } else if (subcommand === 'status') {
      await handleStatus(interaction, guildId);
    } else if (subcommand === 'remove') {
      await interaction.deferReply({ ephemeral: true });
      await handleRemove(interaction, guildId);
    }
  },
};

async function handleSetup(interaction, guild, guildId) {
  try {
    const logTypes = Object.entries(logChannelTypeStore.LOG_TYPES);
    const createdChannels = {};
    let failedCount = 0;

    // Create a category for logs if it doesn't exist
    let logCategory = guild.channels.cache.find(ch =>
      ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('logs')
    );

    if (!logCategory) {
      try {
        logCategory = await guild.channels.create({
          name: 'Logs',
          type: ChannelType.GuildCategory,
        });
      } catch (err) {
        console.error('Failed to create log category:', err);
      }
    }

    // Create a channel for each log type
    for (const [key, logType] of logTypes) {
      try {
        const channelName = `logs-${logType}`;
        let channel = guild.channels.cache.find(ch =>
          ch.name === channelName && ch.type === ChannelType.GuildText
        );

        if (!channel) {
          const createOptions = {
            name: channelName,
            type: ChannelType.GuildText,
            topic: `Log channel for ${logType} events`,
          };

          if (logCategory) {
            createOptions.parent = logCategory.id;
          }

          channel = await guild.channels.create(createOptions);
        }

        // Store the channel ID
        await logChannelTypeStore.setChannel(guildId, logType, channel.id);
        createdChannels[logType] = channel.id;
      } catch (err) {
        console.error(`Failed to create ${logType} log channel:`, err);
        failedCount++;
      }
    }

    const successCount = logTypes.length - failedCount;
    const embed = new EmbedBuilder()
      .setTitle('✅ Logging Setup Complete')
      .setColor(0x00ff00)
      .addFields(
        { name: 'Channels Created', value: `${successCount}/${logTypes.length}`, inline: true },
        { name: 'Status', value: failedCount === 0 ? 'All channels created successfully!' : `${failedCount} channel(s) failed`, inline: true },
      );

    const channelList = Object.entries(createdChannels)
      .map(([type, id]) => `• \`${type}\`: <#${id}>`)
      .join('\n');

    if (channelList) {
      embed.addFields({ name: 'Log Channels', value: channelList, inline: false });
    }

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Setup error:', err);
    await interaction.editReply({ content: 'Failed to setup logging channels.', ephemeral: true });
  }
}

async function handleStatus(interaction, guildId) {
  try {
    const allChannels = await logChannelTypeStore.getAll(guildId);

    const embed = new EmbedBuilder()
      .setTitle('📋 Logging Configuration Status');

    if (Object.keys(allChannels).length === 0) {
      embed.setDescription('No log channels configured. Use `/logconfig setup` to create them.');
      embed.setColor(0xffaa00);
    } else {
      const channelList = Object.entries(allChannels)
        .map(([type, channelId]) => `• \`${type}\`: <#${channelId}>`)
        .join('\n');

      embed.addFields({ name: 'Configured Log Channels', value: channelList, inline: false });
      embed.setColor(0x00ff00);
    }

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error('Status error:', err);
    await interaction.reply({ content: 'Failed to retrieve logging configuration.', ephemeral: true });
  }
}

async function handleRemove(interaction, guildId) {
  try {
    const logType = interaction.options.getString('log_type');
    await logChannelTypeStore.removeChannel(guildId, logType);

    const embed = new EmbedBuilder()
      .setTitle('✅ Log Channel Removed')
      .setColor(0x00ff00)
      .setDescription(`Removed \`${logType}\` log channel from configuration.`);

    try {
      const { applyDefaultColour } = require('../utils/guildColourStore');
      applyDefaultColour(embed, guildId);
    } catch (_) {}

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Remove error:', err);
    await interaction.editReply({ content: 'Failed to remove log channel.', ephemeral: true });
  }
}

