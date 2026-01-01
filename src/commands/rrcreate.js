const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const logger = require('../utils/securityLogger');
const reactionRoleStore = require('../utils/reactionRoleStore');
const reactionRoleManager = require('../utils/reactionRoleManager');

function parseRoleIds(input) {
  const matches = String(input || '').match(/\d{17,20}/g);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

function parseEmojiTokens(input) {
  const matches = String(input || '').match(/<a?:\w+:\d+>|[^\s,]+/g);
  return matches ? matches.filter(Boolean) : [];
}

function parseEmojiToken(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return null;
  const customMatch = trimmed.match(/^<a?:(\w+):(\d+)>$/);
  if (customMatch) {
    const animated = trimmed.startsWith('<a:');
    return {
      id: customMatch[2],
      name: customMatch[1],
      animated: animated ? true : undefined,
    };
  }
  return trimmed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrcreate')
    .setDescription('Create a reaction role select menu')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .setDMPermission(false)
    .addStringOption(opt =>
      opt
        .setName('roles')
        .setDescription('Role mentions or IDs (space or comma separated)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('emojis')
        .setDescription('Optional emoji list aligned to roles (same order)')
    )
    .addStringOption(opt =>
      opt
        .setName('message_id')
        .setDescription('Existing message ID to attach the menu to')
    )
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Channel containing the message (defaults to current channel)')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        )
    )
    .addBooleanOption(opt =>
      opt
        .setName('allow_multiple')
        .setDescription('Allow selecting multiple roles (default on)')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await logger.logPermissionDenied(interaction, 'rrcreate', 'Bot missing Manage Roles');
      return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
    }
    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      await logger.logPermissionDenied(interaction, 'rrcreate', 'User missing Manage Roles');
      return interaction.reply({ content: 'You need Manage Roles to configure reaction roles.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const rolesInput = interaction.options.getString('roles', true);
    const roleIds = parseRoleIds(rolesInput);
    if (!roleIds.length) {
      return interaction.editReply({ content: 'Please provide role mentions or role IDs.' });
    }
    if (roleIds.length > 25) {
      return interaction.editReply({ content: 'You can only include up to 25 roles per menu.' });
    }

    const validRoles = [];
    const missingRoles = [];
    const blockedRoles = [];

    for (const id of roleIds) {
      if (id === interaction.guildId) {
        blockedRoles.push(id);
        continue;
      }
      let role = null;
      try { role = await interaction.guild.roles.fetch(id); } catch (_) {}
      if (!role) {
        missingRoles.push(id);
        continue;
      }
      if (role.managed) {
        blockedRoles.push(id);
        continue;
      }
      if (me.roles.highest.comparePositionTo(role) <= 0) {
        blockedRoles.push(id);
        continue;
      }
      validRoles.push(role);
    }

    if (!validRoles.length) {
      return interaction.editReply({ content: 'None of the provided roles can be managed by the bot.' });
    }

    const emojisInput = interaction.options.getString('emojis');
    const emojiTokens = parseEmojiTokens(emojisInput);
    const emojiMap = {};
    if (emojiTokens.length) {
      for (let i = 0; i < validRoles.length; i += 1) {
        const token = emojiTokens[i];
        if (!token) continue;
        const parsed = parseEmojiToken(token);
        if (!parsed) continue;
        emojiMap[validRoles[i].id] = parsed;
      }
    }

    const allowMultiple = interaction.options.getBoolean('allow_multiple');
    const multi = allowMultiple === null ? true : allowMultiple;

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased?.()) {
      return interaction.editReply({ content: 'Select a text-based channel for the reaction roles message.' });
    }

    const messageId = interaction.options.getString('message_id');
    let targetMessage = null;

    if (messageId) {
      const existingPanel = reactionRoleStore.findPanelByMessageId(interaction.guildId, messageId);
      if (existingPanel) {
        return interaction.editReply({ content: `A reaction role panel already exists for that message (panel #${existingPanel.id}).` });
      }

      try {
        targetMessage = await targetChannel.messages.fetch(messageId);
      } catch (_) {}
      if (!targetMessage) {
        return interaction.editReply({ content: 'Could not find that message in the selected channel.' });
      }
      if (!targetMessage.editable) {
        return interaction.editReply({ content: 'I can only attach menus to messages I can edit.' });
      }
    } else {
      try {
        targetMessage = await targetChannel.send({
          content: '\u200b',
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        console.error('Failed to send reaction role message:', err);
        return interaction.editReply({ content: 'Failed to create the reaction roles message.' });
      }
    }

    let panel = null;
    try {
      panel = reactionRoleStore.createPanel(interaction.guildId, {
        channelId: targetChannel.id,
        messageId: targetMessage.id,
        roleIds: validRoles.map(role => role.id),
        emojis: emojiMap,
        multi,
        createdBy: interaction.user.id,
      });
    } catch (err) {
      console.error('Failed to create reaction role panel:', err);
      return interaction.editReply({ content: 'Failed to create the reaction role panel.' });
    }

    const menu = reactionRoleManager.buildMenuRow(panel, interaction.guild);
    const merged = reactionRoleManager.upsertMenuRow(targetMessage.components, menu.customId, menu.row);
    if (!merged.ok) {
      reactionRoleStore.removePanel(interaction.guildId, panel.id);
      return interaction.editReply({ content: 'That message already has the maximum number of component rows.' });
    }

    try {
      await targetMessage.edit({ components: merged.rows, embeds: targetMessage.embeds });
    } catch (err) {
      reactionRoleStore.removePanel(interaction.guildId, panel.id);
      console.error('Failed to attach reaction role menu:', err);
      return interaction.editReply({ content: 'Failed to attach the reaction role menu to the message.' });
    }

    const link = `https://discord.com/channels/${interaction.guildId}/${targetChannel.id}/${targetMessage.id}`;
    const notes = [];
    if (missingRoles.length) notes.push('Some role IDs were not found.');
    if (blockedRoles.length) notes.push('Some roles could not be used due to role hierarchy or managed roles.');
    const tail = notes.length ? ` ${notes.join(' ')}` : '';

    return interaction.editReply({ content: `Reaction role panel created: ${link}.${tail}` });
  },
};
