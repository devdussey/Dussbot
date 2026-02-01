const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const logSender = require('../utils/logSender');
const { buildRupeeSpendEmbed } = require('../utils/rupeeLogEmbed');

const LOG_KEY = 'rupee_spend';
const TEST_DESCRIPTION = 'This is a test log to confirm rupee spend routing (no rupees were actually spent).';

function formatStatusLabel(status) {
  return status === 'enable' ? 'enabled' : status === 'disable' ? 'disabled' : 'test send';
}

async function ensureChannelUsable(channel, guild) {
  const isForum = channel?.type === ChannelType.GuildForum;
  const isThread = typeof channel?.isThread === 'function' ? channel.isThread() : Boolean(channel?.isThread);
  if (!channel?.isTextBased?.() && !isForum) {
    return 'Please pick a text channel, announcement channel, or forum.';
  }

  let targetMember = guild?.members?.me;
  if (!targetMember && typeof guild?.members?.fetchMe === 'function') {
    targetMember = await guild.members.fetchMe().catch(() => null);
  }
  if (!targetMember) return null;

  const permissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.EmbedLinks,
  ];
  if (isForum) {
    permissions.push(
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.SendMessagesInThreads,
    );
  } else if (isThread) {
    permissions.push(PermissionsBitField.Flags.SendMessagesInThreads);
  } else {
    permissions.push(PermissionsBitField.Flags.SendMessages);
  }

  const perms = channel.permissionsFor(targetMember);
  if (!perms || !perms.has(permissions)) {
    const missing = permissions
      .filter(flag => !perms?.has(flag))
      .map(flag => Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag)?.[0] || String(flag));
    return `I need ${missing.join(', ')} permissions in ${channel} to post rupee spend logs.`;
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rupeelogconfig')
    .setDescription('Configure where rupee store spending logs are sent')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption(option =>
      option
        .setName('status')
        .setDescription('Enable, disable, or test the rupee spend log route')
        .setRequired(true)
        .addChoices(
          { name: 'enable', value: 'enable' },
          { name: 'disable', value: 'disable' },
          { name: 'test send', value: 'test' },
        ))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel that will receive the rupee spend logs')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure rupee logs.', ephemeral: true });
    }

    const status = interaction.options.getString('status', true);
    const channel = interaction.options.getChannel('channel', true);
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({ content: 'Unable to resolve this server. Try again later.', ephemeral: true });
    }

    const channelError = await ensureChannelUsable(channel, guild);
    if (channelError) {
      return interaction.reply({ content: channelError, ephemeral: true });
    }

    const enable = status !== 'disable';

    try {
      if (channel) {
        await logChannelTypeStore.setChannel(guild.id, LOG_KEY, channel.id);
      }
      await logChannelTypeStore.setEnabled(guild.id, LOG_KEY, enable);
    } catch (err) {
      console.error('Failed to update rupee log config:', err);
      return interaction.reply({ content: 'Failed to update rupee log configuration. Try again later.', ephemeral: true });
    }

    let testMessage = '';
    if (status === 'test') {
      const testEmbed = buildRupeeSpendEmbed({
        guildId: guild.id,
        actor: interaction.user,
        itemLabel: 'Log configuration test',
        itemCost: 0,
        target: interaction.user,
        balance: 0,
        description: TEST_DESCRIPTION,
        extraFields: [
          { name: 'Route', value: 'rupee_spend', inline: true },
          { name: 'Channel', value: channel ? `<#${channel.id}>` : 'None', inline: true },
          { name: 'Note', value: 'If you see this embed in the configured channel, the routing works.', inline: false },
        ],
      });

      let sent = false;
      try {
        sent = await logSender.sendLog({
          guildId: guild.id,
          logType: LOG_KEY,
          embed: testEmbed,
          client: interaction.client,
        });
      } catch (err) {
        console.error('Failed to send rupee log test:', err);
      }

      testMessage = sent
        ? '\nTest log: ✅ delivered.'
        : '\nTest log: ❌ could not be delivered. Check channel permissions or routing.';
    }

    return interaction.reply({
      content: `Rupee spend logs are now **${formatStatusLabel(status)}**. Channel: <#${channel.id}>.${testMessage}`,
      ephemeral: true,
    });
  },
};
