const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const logger = require('../utils/securityLogger');
const reactionRoleStore = require('../utils/reactionRoleStore');
const reactionRoleManager = require('../utils/reactionRoleManager');
const { parseColorInput } = require('../utils/colorParser');

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

async function handleCreate(interaction) {
  const me = interaction.guild.members.me;
  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    await logger.logPermissionDenied(interaction, 'reactionrole create', 'Bot missing Manage Roles');
    return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
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
  const embedOpt = interaction.options.getBoolean('embed');
  const useEmbed = embedOpt !== false;
  const embedColourInput = interaction.options.getString('embed_colour');
  const embedImageUrlInput = (interaction.options.getString('embed_image_url') || '').trim();
  const embedImageUpload = interaction.options.getAttachment('embed_image_upload') || null;

  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  if (!targetChannel || !targetChannel.isTextBased?.()) {
    return interaction.editReply({ content: 'Select a text-based channel for the reaction roles message.' });
  }

  const messageId = interaction.options.getString('message_id');
  let targetMessage = null;
  let newEmbed = null;
  const embedFiles = [];

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

  if (useEmbed) {
    let imageUrl = null;
    if (embedImageUpload && embedImageUpload.contentType?.startsWith('image/')) {
      const fileName = embedImageUpload.name || 'image.png';
      imageUrl = `attachment://${fileName}`;
      embedFiles.push({ attachment: embedImageUpload.url, name: fileName });
    } else if (embedImageUrlInput) {
      try {
        const parsedUrl = new URL(embedImageUrlInput);
        if (['http:', 'https:'].includes(parsedUrl.protocol)) {
          imageUrl = parsedUrl.toString();
        }
      } catch (_) {}
    }

    const colour = parseColorInput(embedColourInput, 0x00f9ff);
    newEmbed = new EmbedBuilder().setColor(colour);
    if (imageUrl) {
      newEmbed.setImage(imageUrl);
    }
    if (!imageUrl && targetMessage.embeds?.length) {
      newEmbed = null;
    }
  }

  const hasAttachments = messageId && targetMessage.attachments?.size > 0;
  const baseEmbeds = (!useEmbed || hasAttachments) ? [] : (targetMessage.embeds || []);
  let embedsToUse = newEmbed ? [newEmbed] : baseEmbeds;

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

  const summary = reactionRoleManager.buildSummaryEmbed(panel, interaction.guild);
  const summaryResult = reactionRoleManager.mergeSummaryEmbed(embedsToUse, summary.embed, panel);
  const finalEmbeds = summaryResult.ok ? summaryResult.embeds : embedsToUse;

  const editPayload = { components: merged.rows, embeds: finalEmbeds };
  if (embedFiles.length) editPayload.files = embedFiles;

  try {
    await targetMessage.edit(editPayload);
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
}

async function handleDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const id = interaction.options.getInteger('id');
  const messageId = interaction.options.getString('message_id');
  if (!id && !messageId) {
    return interaction.editReply({ content: 'Provide a panel ID or message ID to delete.' });
  }

  let panel = null;
  if (id) panel = reactionRoleStore.getPanel(interaction.guildId, id);
  if (!panel && messageId) {
    panel = reactionRoleStore.findPanelByMessageId(interaction.guildId, messageId);
  }

  if (!panel) {
    return interaction.editReply({ content: 'No matching reaction role panel was found.' });
  }

  reactionRoleStore.removePanel(interaction.guildId, panel.id);

  let removedMenu = false;
  let removedSummary = false;
  try {
    const channel = await interaction.guild.channels.fetch(panel.channelId);
    if (channel?.isTextBased?.()) {
      const message = await channel.messages.fetch(panel.messageId);
      if (message?.editable) {
        const summaryKey = `Reaction Roles - Panel #${panel.id}`;
        const hadSummary = Array.isArray(message.embeds)
          ? message.embeds.some(e => (e?.footer?.text || '') === summaryKey)
          : false;
        const res = reactionRoleManager.removeMenuRow(message.components, `rr:select:${panel.id}`);
        const summaryRes = reactionRoleManager.removeSummaryEmbed(message.embeds, panel.id);
        const payload = {};
        if (res.removed) payload.components = res.rows;
        if (summaryRes.removed) payload.embeds = summaryRes.embeds;
        if (Object.keys(payload).length) {
          await message.edit(payload);
          removedMenu = res.removed;
          removedSummary = summaryRes.removed || !hadSummary;
        } else if (!hadSummary) {
          removedSummary = true;
        }
      }
    }
  } catch (_) {}

  const missingBits = [];
  if (!removedMenu) missingBits.push('menu');
  if (!removedSummary) missingBits.push('summary embed');
  const suffix = missingBits.length
    ? ` (could not remove ${missingBits.join(' and ')} from the message)`
    : '';
  return interaction.editReply({ content: `Removed reaction role panel #${panel.id}${suffix}.` });
}

async function handleEdit(interaction) {
  const me = interaction.guild.members.me;
  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const id = interaction.options.getInteger('id');
  const messageIdOpt = interaction.options.getString('message_id');
  if (!id && !messageIdOpt) {
    return interaction.editReply({ content: 'Provide a panel ID or message ID to edit.' });
  }

  let panel = null;
  if (id) panel = reactionRoleStore.getPanel(interaction.guildId, id);
  if (!panel && messageIdOpt) {
    panel = reactionRoleStore.findPanelByMessageId(interaction.guildId, messageIdOpt);
  }
  if (!panel) {
    return interaction.editReply({ content: 'No matching reaction role panel was found.' });
  }

  const targetChannel = interaction.options.getChannel('channel') || await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
  if (!targetChannel || !targetChannel.isTextBased?.()) {
    return interaction.editReply({ content: 'Select a text-based channel for the reaction roles message.' });
  }

  let targetMessage = null;
  try { targetMessage = await targetChannel.messages.fetch(panel.messageId); } catch (_) {}
  if (!targetMessage) {
    return interaction.editReply({ content: 'Could not find the stored message for this panel.' });
  }
  if (!targetMessage.editable) {
    return interaction.editReply({ content: 'I can only edit messages I have permission to modify.' });
  }

  const rolesInput = interaction.options.getString('roles');
  const addRolesInput = interaction.options.getString('add_roles');
  const removeRolesInput = interaction.options.getString('remove_roles');
  const emojisInput = interaction.options.getString('emojis');
  const allowMultipleOpt = interaction.options.getBoolean('allow_multiple');
  const contentInput = interaction.options.getString('content');
  const embedOpt = interaction.options.getBoolean('embed');
  const embedColourInput = interaction.options.getString('embed_colour');
  const embedImageUrlInput = (interaction.options.getString('embed_image_url') || '').trim();
  const embedImageUpload = interaction.options.getAttachment('embed_image_upload') || null;

  let roleIds = rolesInput ? parseRoleIds(rolesInput) : Array.from(panel.roleIds || []);
  const addRoleIds = parseRoleIds(addRolesInput);
  const removeRoleIds = parseRoleIds(removeRolesInput);

  if (!rolesInput) {
    const roleSet = new Set(roleIds);
    for (const id of addRoleIds) roleSet.add(id);
    for (const id of removeRoleIds) roleSet.delete(id);
    roleIds = Array.from(roleSet);
  }

  if (roleIds.length > 25) roleIds = roleIds.slice(0, 25);

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

  const emojiMap = {};
  const existingEmojiMap = panel.emojis && typeof panel.emojis === 'object' ? panel.emojis : {};
  for (const role of validRoles) {
    if (Object.prototype.hasOwnProperty.call(existingEmojiMap, role.id)) {
      const emoji = existingEmojiMap[role.id];
      if (emoji) emojiMap[role.id] = emoji;
    }
  }

  if (emojisInput) {
    const emojiTokens = parseEmojiTokens(emojisInput);
    for (let i = 0; i < validRoles.length; i += 1) {
      const token = emojiTokens[i];
      if (!token) continue;
      const parsed = parseEmojiToken(token);
      if (!parsed) continue;
      emojiMap[validRoles[i].id] = parsed;
    }
  }

  const multi = allowMultipleOpt === null ? panel.multi : allowMultipleOpt;
  const updatedPanel = { ...panel, roleIds: validRoles.map(role => role.id), emojis: emojiMap, multi };
  const menu = reactionRoleManager.buildMenuRow(updatedPanel, interaction.guild);
  const merged = reactionRoleManager.upsertMenuRow(targetMessage.components, menu.customId, menu.row);
  if (!merged.ok) {
    return interaction.editReply({ content: 'That message already has the maximum number of component rows.' });
  }

  let embedsToUse = Array.isArray(targetMessage.embeds) ? targetMessage.embeds : [];
  let embedFiles = [];
  const shouldUpdateEmbed = embedOpt !== null || embedColourInput || embedImageUrlInput || embedImageUpload;

  if (embedOpt === false) {
    embedsToUse = [];
  } else if (shouldUpdateEmbed) {
    let imageUrl = null;
    if (embedImageUpload && embedImageUpload.contentType?.startsWith('image/')) {
      const fileName = embedImageUpload.name || 'image.png';
      imageUrl = `attachment://${fileName}`;
      embedFiles = [{ attachment: embedImageUpload.url, name: fileName }];
    } else if (embedImageUrlInput) {
      try {
        const parsedUrl = new URL(embedImageUrlInput);
        if (['http:', 'https:'].includes(parsedUrl.protocol)) {
          imageUrl = parsedUrl.toString();
        }
      } catch (_) {}
    }

    const firstEmbed = targetMessage.embeds?.[0];
    const existingColour = typeof firstEmbed?.data?.color === 'number'
      ? firstEmbed.data.color
      : (typeof firstEmbed?.color === 'number' ? firstEmbed.color : 0x00f9ff);
    const colour = parseColorInput(embedColourInput, existingColour || 0x00f9ff);
    const embed = firstEmbed ? EmbedBuilder.from(firstEmbed) : new EmbedBuilder();
    embed.setColor(colour);
    if (imageUrl) embed.setImage(imageUrl);
    embedsToUse = [embed];
  }

  const summary = reactionRoleManager.buildSummaryEmbed(updatedPanel, interaction.guild);
  const summaryResult = reactionRoleManager.mergeSummaryEmbed(embedsToUse, summary.embed, updatedPanel);
  if (summaryResult.ok) {
    embedsToUse = summaryResult.embeds;
  }

  const editPayload = {
    components: merged.rows,
    embeds: embedsToUse,
  };
  if (contentInput !== null) editPayload.content = contentInput;
  if (embedFiles.length) editPayload.files = embedFiles;

  try {
    await targetMessage.edit(editPayload);
  } catch (err) {
    console.error('Failed to edit reaction role message:', err);
    return interaction.editReply({ content: 'Failed to update the reaction role message.' });
  }

  const stored = reactionRoleStore.updatePanel(interaction.guildId, panel.id, {
    roleIds: updatedPanel.roleIds,
    emojis: updatedPanel.emojis,
    multi: updatedPanel.multi,
  });

  if (!stored) {
    return interaction.editReply({ content: 'Updated the message, but failed to update the stored panel.' });
  }

  const link = `https://discord.com/channels/${interaction.guildId}/${targetChannel.id}/${targetMessage.id}`;
  const notes = [];
  if (missingRoles.length) notes.push('Some role IDs were not found.');
  if (blockedRoles.length) notes.push('Some roles could not be used due to role hierarchy or managed roles.');
  const tail = notes.length ? ` ${notes.join(' ')}` : '';

  return interaction.editReply({ content: `Reaction role panel #${panel.id} updated: ${link}.${tail}` });
}

async function handleList(interaction) {
  const panels = reactionRoleStore.listPanels(interaction.guildId);
  if (!panels.length) {
    return interaction.reply({ content: 'No reaction role panels configured yet.', ephemeral: true });
  }

  const lines = panels.map(panel => {
    const mode = panel.multi ? 'multi' : 'single';
    const link = `https://discord.com/channels/${interaction.guildId}/${panel.channelId}/${panel.messageId}`;
    const roles = panel.roleIds.length ? panel.roleIds.map(id => `<@&${id}>`).join(', ') : 'None';
    return `#${panel.id} | ${mode} | <#${panel.channelId}> | ${link}\n    Roles: ${roles}`;
  });

  const content = lines.join('\n').slice(0, 1900);
  return interaction.reply({ content, ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Manage reaction role panels')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a reaction role select menu')
        .addStringOption(opt =>
          opt
            .setName('roles')
            .setDescription('Role mentions or IDs (space or comma separated)')
            .setRequired(true))
        .addStringOption(opt =>
          opt
            .setName('emojis')
            .setDescription('Optional emoji list aligned to roles (same order)'))
        .addStringOption(opt =>
          opt
            .setName('message_id')
            .setDescription('Existing message ID to attach the menu to'))
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel containing the message (defaults to current channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
            ))
        .addBooleanOption(opt =>
          opt
            .setName('allow_multiple')
            .setDescription('Allow selecting multiple roles (default on)'))
        .addBooleanOption(opt =>
          opt
            .setName('embed')
            .setDescription('Include an embed with the menu (default: true)'))
        .addStringOption(opt =>
          opt
            .setName('embed_colour')
            .setDescription('Embed colour (hex or name). Default: #00f9ff'))
        .addStringOption(opt =>
          opt
            .setName('embed_image_url')
            .setDescription('Image URL to show in the embed'))
        .addAttachmentOption(opt =>
          opt
            .setName('embed_image_upload')
            .setDescription('Upload an image to show in the embed')))
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete a reaction role panel')
        .addIntegerOption(opt =>
          opt
            .setName('id')
            .setDescription('Reaction role panel ID'))
        .addStringOption(opt =>
          opt
            .setName('message_id')
            .setDescription('Message ID that has the menu attached')))
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Edit an existing reaction role panel')
        .addIntegerOption(opt =>
          opt
            .setName('id')
            .setDescription('Reaction role panel ID'))
        .addStringOption(opt =>
          opt
            .setName('message_id')
            .setDescription('Message ID that has the menu attached'))
        .addStringOption(opt =>
          opt
            .setName('roles')
            .setDescription('Role mentions or IDs to replace the panel roles'))
        .addStringOption(opt =>
          opt
            .setName('add_roles')
            .setDescription('Roles to add (mention or ID, space/comma separated)'))
        .addStringOption(opt =>
          opt
            .setName('remove_roles')
            .setDescription('Roles to remove (mention or ID, space/comma separated)'))
        .addStringOption(opt =>
          opt
            .setName('emojis')
            .setDescription('Optional emoji list aligned to the final roles (same order)'))
        .addBooleanOption(opt =>
          opt
            .setName('allow_multiple')
            .setDescription('Allow selecting multiple roles (default keeps current setting)'))
        .addStringOption(opt =>
          opt
            .setName('content')
            .setDescription('Replace the message content'))
        .addBooleanOption(opt =>
          opt
            .setName('embed')
            .setDescription('Update or remove the embed (true = keep/add, false = remove)'))
        .addStringOption(opt =>
          opt
            .setName('embed_colour')
            .setDescription('Embed colour (hex or name)'))
        .addStringOption(opt =>
          opt
            .setName('embed_image_url')
            .setDescription('Image URL to show in the embed'))
        .addAttachmentOption(opt =>
          opt
            .setName('embed_image_upload')
            .setDescription('Upload an image to show in the embed'))
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel containing the target message (defaults to stored channel)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List reaction role panels for this server')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      await logger.logPermissionDenied(interaction, 'reactionrole', 'User missing Manage Roles');
      return interaction.reply({ content: 'You need Manage Roles to manage reaction roles.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'create') {
      return handleCreate(interaction);
    }
    if (subcommand === 'delete') {
      return handleDelete(interaction);
    }
    if (subcommand === 'edit') {
      return handleEdit(interaction);
    }
    if (subcommand === 'list') {
      return handleList(interaction);
    }

    return interaction.reply({ content: 'Unknown reaction role subcommand.', ephemeral: true });
  },
};
