const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const axios = require('axios');
const sharp = require('sharp');
const modlog = require('../utils/modLogger');
const { getUserRecord, upsertUserRecord } = require('../utils/vanityRoleStore');

const ROLE_ICON_SIZE_PX = 64;
const MAX_ROLE_ICON_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_ICON_FORMATS = new Set(['png', 'jpg', 'jpeg']);

function normalizeHex6(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m0x = s.match(/^0x([0-9a-fA-F]{6})$/);
  if (m0x) return `#${m0x[1].toUpperCase()}`;
  const m = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return `#${hex.toUpperCase()}`;
}

function pickActiveColors(rec, which) {
  const active = which || rec?.active || 'primary';
  const main = active === 'secondary' ? rec?.secondary : rec?.primary;
  const other = active === 'secondary' ? rec?.primary : rec?.secondary;

  if (typeof main === 'string') {
    return {
      active,
      primaryColor: main,
      secondaryColor: typeof other === 'string' ? other : null,
    };
  }

  if (typeof other === 'string') {
    return {
      active: 'primary',
      primaryColor: other,
      secondaryColor: null,
    };
  }

  return { active, primaryColor: null, secondaryColor: null };
}

function inferFormatFromName(name) {
  if (!name || typeof name !== 'string') return null;
  const match = name.toLowerCase().match(/\.([a-z0-9]+)(?:\?.*)?$/);
  if (!match) return null;
  const ext = match[1];
  if (ext === 'jpeg' || ext === 'jpg') return 'jpeg';
  if (ext === 'png') return 'png';
  return null;
}

function inferFormatFromContentType(contentType) {
  if (!contentType || typeof contentType !== 'string') return null;
  const lower = contentType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpeg';
  return null;
}

async function fetchImageBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    maxContentLength: MAX_DOWNLOAD_BYTES,
    validateStatus: status => status >= 200 && status < 300,
    timeout: 10_000,
  });
  return Buffer.from(response.data);
}

async function prepareRoleIconBuffer(sourceBuffer, formatHint) {
  if (!sourceBuffer || !sourceBuffer.length) throw new Error('No image data found.');

  let metadata;
  try {
    metadata = await sharp(sourceBuffer).metadata();
  } catch (_) {
    throw new Error('Could not read that image. Use a PNG or JPG file.');
  }

  const detectedFormat = metadata?.format ? metadata.format.toLowerCase() : null;
  const normalizedFormat = detectedFormat || (formatHint ? formatHint.toLowerCase() : null);
  if (!normalizedFormat || !ALLOWED_ICON_FORMATS.has(normalizedFormat)) {
    throw new Error('Role icon must be a PNG or JPG image.');
  }

  const base = sharp(sourceBuffer).resize(ROLE_ICON_SIZE_PX, ROLE_ICON_SIZE_PX, { fit: 'cover' });
  let outputBuffer;

  if (normalizedFormat === 'jpeg' || normalizedFormat === 'jpg') {
    outputBuffer = await base.clone().jpeg({ quality: 90 }).toBuffer();
  } else {
    outputBuffer = await base.clone().png().toBuffer();
  }

  if (outputBuffer.length > MAX_ROLE_ICON_BYTES) {
    const jpegBuffer = await base.clone().jpeg({ quality: 85 }).toBuffer();
    if (jpegBuffer.length <= MAX_ROLE_ICON_BYTES) {
      return { buffer: jpegBuffer, format: 'jpeg' };
    }
    throw new Error('Role icon must be under 256KB after resizing to 64x64. Try a smaller image.');
  }

  return { buffer: outputBuffer, format: normalizedFormat === 'jpg' ? 'jpeg' : normalizedFormat };
}

async function getOrCreateVanityRole({ interaction, member, me, rec, name, colors, selectedRole }) {
  const reason = `Vanity role for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;

  let role = selectedRole || null;
  if (!role && rec?.roleId) {
    role = interaction.guild.roles.cache.get(rec.roleId) || null;
    if (!role) {
      try {
        role = await interaction.guild.roles.fetch(rec.roleId);
      } catch (_) {
        role = null;
      }
    }
  }

  if (role) {
    if (role.managed) throw new Error('Your vanity role is managed and cannot be edited.');
    if (me.roles.highest.comparePositionTo(role) <= 0) throw new Error('My highest role must be above your vanity role.');
    return { role, created: false, reason };
  }

  const roleName = (name || `${member.displayName}'s Vanity`).slice(0, 100);
  const roleColors = colors?.primaryColor ? {
    primaryColor: colors.primaryColor,
    secondaryColor: colors.secondaryColor ?? null,
  } : undefined;
  const createdRole = await interaction.guild.roles.create({
    name: roleName,
    colors: roleColors,
    reason,
  });

  if (me.roles.highest.comparePositionTo(createdRole) <= 0) {
    // Should not be possible if created, but guard anyway.
    throw new Error('Created role is above my highest role. Move my bot role higher and try again.');
  }

  return { role: createdRole, created: true, reason };
}

async function ensureRolePositionUnderBot({ role, me, reason }) {
  const desired = Math.max(1, me.roles.highest.position - 1);
  if (role.position === desired) return { desired };

  try {
    await role.setPosition(desired, { reason });
  } catch (_) {
    // best-effort
  }

  return { desired };
}

function buildVanityRoleModal(userId, rec, roleId) {
  const modal = new ModalBuilder()
    .setCustomId(`vanityrole:modal:${userId}:${roleId}`)
    .setTitle('Vanity Role Setup');

  const nameInput = new TextInputBuilder()
    .setCustomId('vanityrole:name')
    .setLabel('Role Name (optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);

  const primaryInput = new TextInputBuilder()
    .setCustomId('vanityrole:primary')
    .setLabel('Primary Colour')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#ff0000')
    .setMinLength(6)
    .setMaxLength(7)
    .setRequired(false);

  const secondaryInput = new TextInputBuilder()
    .setCustomId('vanityrole:secondary')
    .setLabel('Secondary Colour (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#00ff00')
    .setMaxLength(7)
    .setRequired(false);

  if (rec?.primary) primaryInput.setValue(rec.primary);
  if (rec?.secondary) secondaryInput.setValue(rec.secondary);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(primaryInput),
    new ActionRowBuilder().addComponents(secondaryInput),
  );

  return modal;
}

async function handleVanityRoleSetup(interaction, inputs) {
  try {
    if (!interaction.inGuild()) {
      return interaction.editReply({ content: 'Use this command in a server.' });
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'Administrator permission is required to use /vanityrole.' });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.editReply({ content: 'I need the Manage Roles permission.' });
    }

    const member = interaction.member;
    if (!member || !member.roles) {
      return interaction.editReply({ content: 'Could not resolve your member record. Try again.' });
    }

    const rec = getUserRecord(interaction.guildId, interaction.user.id);
    const name = inputs?.name ? inputs.name.trim() : '';
    const primaryRaw = inputs?.primary ? inputs.primary.trim() : '';
    const secondaryRaw = inputs?.secondary ? inputs.secondary.trim() : '';
    const useRaw = inputs?.use ? inputs.use.trim().toLowerCase() : '';
    const roleId = inputs?.roleId ? String(inputs.roleId) : null;
    const hoistPreference = typeof rec?.hoist === 'boolean' ? rec.hoist : false;

    if (!roleId) {
      return interaction.editReply({ content: 'Select a role first with `/vanityrole setup role:@Role`.' });
    }

    if (roleId === interaction.guild.id) {
      return interaction.editReply({ content: 'You cannot use @everyone as a vanity role.' });
    }

    let selectedRole = interaction.guild.roles.cache.get(roleId) || null;
    if (!selectedRole) {
      try { selectedRole = await interaction.guild.roles.fetch(roleId); } catch (_) {}
    }
    if (!selectedRole) {
      return interaction.editReply({ content: 'That role no longer exists. Run `/vanityrole setup` again.' });
    }
    if (selectedRole.managed) {
      return interaction.editReply({ content: 'That role is managed and cannot be used as a vanity role.' });
    }
    if (me.roles.highest.comparePositionTo(selectedRole) <= 0) {
      return interaction.editReply({ content: 'My highest role must be above the selected role.' });
    }

    const primaryIn = primaryRaw || null;
    const secondaryIn = secondaryRaw || null;

    const primary = primaryIn ? normalizeHex6(primaryIn) : null;
    const secondary = secondaryIn ? normalizeHex6(secondaryIn) : null;
    if (primaryIn && !primary) return interaction.editReply({ content: 'Invalid primary colour. Use a hex like `#5865F2`.' });
    if (secondaryIn && !secondary) return interaction.editReply({ content: 'Invalid secondary colour. Use a hex like `#5865F2`.' });

    const use = useRaw === 'secondary' ? 'secondary' : useRaw === 'primary' ? 'primary' : null;
    const merged = {
      roleId,
      primary: primaryIn ? primary : rec?.primary ?? null,
      secondary: secondaryIn ? secondary : rec?.secondary ?? null,
      active: use || rec?.active || 'primary',
      hoist: hoistPreference,
    };

    if (merged.active === 'secondary' && !merged.secondary) {
      return interaction.editReply({ content: 'No secondary colour saved yet. Set it with `/vanityrole setup`.' });
    }

    const picked = pickActiveColors(merged, merged.active);
    const { role, created, reason } = await getOrCreateVanityRole({
      interaction,
      member,
      me,
      rec: merged,
      name: name || null,
      colors: picked,
      selectedRole,
    });

    if (name) {
      try { await role.setName(name.slice(0, 100), reason); } catch (_) {}
    }
    if (picked.primaryColor) {
      try {
        await role.setColors({
          primaryColor: picked.primaryColor,
          secondaryColor: picked.secondaryColor ?? null,
        }, reason);
      } catch (_) {}
    }

    if (typeof merged.hoist === 'boolean') {
      try {
        await role.setHoist(merged.hoist, reason);
      } catch (_) {}
    }

    if (!member.roles.cache.has(role.id)) {
      try { await member.roles.add(role, reason); } catch (err) {
        throw new Error(`I created the role, but couldn't assign it to you: ${err.message || 'Unknown error'}`);
      }
    }

    const pos = await ensureRolePositionUnderBot({ role, me, reason });

    const saved = await upsertUserRecord(interaction.guildId, interaction.user.id, {
      roleId: role.id,
      primary: merged.primary,
      secondary: merged.secondary,
      active: picked.active,
      hoist: merged.hoist,
    });

    try { await modlog.log(interaction, created ? 'Vanity Role Created' : 'Vanity Role Updated', {
      target: `${interaction.user.tag} (${interaction.user.id})`,
      reason: created ? 'Created vanity role' : 'Updated vanity role',
      extraFields: [
        { name: 'Role', value: `${role} (${role.id})`, inline: false },
        { name: 'Primary', value: saved.primary || 'not set', inline: true },
        { name: 'Secondary', value: saved.secondary || 'not set', inline: true },
        { name: 'Gradient Primary', value: saved.active, inline: true },
        { name: 'Displayed Separately', value: saved.hoist ? 'yes' : 'no', inline: true },
        { name: 'Position', value: `${role.position} (desired ${pos.desired})`, inline: true },
      ],
    }); } catch (_) {}

    return interaction.editReply({
      content: `${created ? 'Created' : 'Updated'} your vanity role: ${role}.`,
    });
  } catch (err) {
    return interaction.editReply({ content: `Error: ${err.message || 'Unknown error'}` });
  }
}

async function handleVanityRoleModalSubmit(interaction, roleId) {
  const nameRaw = (interaction.fields.getTextInputValue('vanityrole:name') || '').trim();
  const primaryRaw = (interaction.fields.getTextInputValue('vanityrole:primary') || '').trim();
  const secondaryRaw = (interaction.fields.getTextInputValue('vanityrole:secondary') || '').trim();

  return handleVanityRoleSetup(interaction, {
    name: nameRaw || null,
    primary: primaryRaw || null,
    secondary: secondaryRaw || null,
    use: null,
    roleId,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vanityrole')
    .setDescription('Create and manage your vanity role (admins only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Open the vanity role setup form')
        .addRoleOption(opt =>
          opt.setName('role')
            .setDescription('Select the role to use as your vanity role')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('colour')
        .setDescription('Apply your saved colours (solid or gradient)')
        .addStringOption(opt =>
          opt.setName('use')
            .setDescription('Flip which colour is primary in the gradient')
            .addChoices(
              { name: 'primary', value: 'primary' },
              { name: 'secondary', value: 'secondary' },
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('name')
        .setDescription('Change your vanity role name')
        .addStringOption(opt =>
          opt.setName('value')
            .setDescription('New role name')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('icon')
        .setDescription('Set a 64x64 PNG/JPG icon on your vanity role')
        .addAttachmentOption(opt =>
          opt
            .setName('file')
            .setDescription('Upload a PNG/JPG under 256KB (will be resized to 64x64)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('url')
            .setDescription('Direct PNG/JPG link under 256KB (will be resized to 64x64)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('display')
        .setDescription('Toggle whether your vanity role displays separately from online members')
        .addBooleanOption(opt =>
          opt
            .setName('hoist')
            .setDescription('Display the role separately from online members')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to use /vanityrole.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
    }

    const member = interaction.member;
    if (!member || !member.roles) {
      return interaction.reply({ content: 'Could not resolve your member record. Try again.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    const rec = getUserRecord(interaction.guildId, interaction.user.id);

    try {
      if (sub === 'setup') {
        const role = interaction.options.getRole('role', true);
        if (!role) {
          return interaction.reply({ content: 'Please select a role to continue.', ephemeral: true });
        }
        if (role.id === interaction.guild.id) {
          return interaction.reply({ content: 'You cannot use @everyone as a vanity role.', ephemeral: true });
        }
        if (role.managed) {
          return interaction.reply({ content: 'That role is managed and cannot be used as a vanity role.', ephemeral: true });
        }
        if (me.roles.highest.comparePositionTo(role) <= 0) {
          return interaction.reply({ content: 'My highest role must be above the selected role.', ephemeral: true });
        }

        const modal = buildVanityRoleModal(interaction.user.id, rec, role.id);
        try {
          await interaction.showModal(modal);
        } catch (_) {
          return interaction.reply({ content: 'Could not open the vanity role form. Please try again.', ephemeral: true });
        }
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      if (sub === 'icon') {
        if (!rec?.roleId) return interaction.editReply({ content: 'No vanity role found. Run `/vanityrole setup` first.' });
        const role = interaction.guild.roles.cache.get(rec.roleId) || await interaction.guild.roles.fetch(rec.roleId).catch(() => null);
        if (!role) return interaction.editReply({ content: 'Your saved vanity role no longer exists. Run `/vanityrole setup` to recreate it.' });
        if (role.managed) return interaction.editReply({ content: 'Your vanity role is managed and cannot be edited.' });
        if (me.roles.highest.comparePositionTo(role) <= 0) return interaction.editReply({ content: 'My highest role must be above your vanity role.' });
        const supportsRoleIcons = interaction.guild.features?.includes?.('ROLE_ICONS');
        if (!supportsRoleIcons) return interaction.editReply({ content: 'This server does not support role icons.' });

        const attachment = interaction.options.getAttachment('file');
        const urlInputRaw = interaction.options.getString('url');
        const urlInput = urlInputRaw ? urlInputRaw.trim() : '';

        if (!attachment && !urlInput) {
          return interaction.editReply({ content: 'Attach a PNG/JPG (64x64, under 256KB) or provide a direct image URL.' });
        }
        if (attachment?.contentType && !inferFormatFromContentType(attachment.contentType)) {
          return interaction.editReply({ content: 'Role icon must be a PNG or JPG image.' });
        }
        if (attachment?.size && attachment.size > MAX_DOWNLOAD_BYTES) {
          return interaction.editReply({ content: 'Image file is too large. Please use a PNG/JPG under 5MB.' });
        }
        if (urlInput && !/^https?:\/\//i.test(urlInput)) {
          return interaction.editReply({ content: 'Provide a valid http(s) link to a PNG or JPG image.' });
        }

        const formatHint = attachment
          ? inferFormatFromContentType(attachment.contentType) || inferFormatFromName(attachment.name)
          : inferFormatFromName(urlInput);

        const downloadUrl = attachment?.url || urlInput;
        let downloaded;
        try {
          downloaded = await fetchImageBuffer(downloadUrl);
        } catch (err) {
          return interaction.editReply({ content: 'Could not download that image. Make sure the link is reachable and under 5MB.' });
        }

        let prepared;
        try {
          prepared = await prepareRoleIconBuffer(downloaded, formatHint);
        } catch (err) {
          return interaction.editReply({ content: err.message || 'Could not process that image.' });
        }

        const reason = `Vanity role icon set for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;
        try {
          await role.setIcon(prepared.buffer, reason);
        } catch (err) {
          let msg = 'Failed to set that role icon.';
          if (!supportsRoleIcons) {
            msg = 'This server does not support role icons.';
          } else if (err?.message?.toLowerCase?.().includes('role icon')) {
            msg = 'This server may not support role icons or I lack permission to set them.';
          }
          return interaction.editReply({ content: msg });
        }

        try { await modlog.log(interaction, 'Vanity Role Icon Updated', {
          target: `${interaction.user.tag} (${interaction.user.id})`,
          reason: 'Updated vanity role icon',
          extraFields: [
            { name: 'Role', value: `${role} (${role.id})`, inline: false },
            { name: 'Source', value: attachment ? 'Attachment' : 'Link', inline: true },
            { name: 'Format', value: prepared.format || 'unknown', inline: true },
            { name: 'Size', value: `${Math.ceil(prepared.buffer.length / 1024)} KB`, inline: true },
          ],
        }); } catch (_) {}

        return interaction.editReply({ content: `Updated the icon for ${role}.` });
      }

      if (sub === 'display') {
        if (!rec?.roleId) return interaction.editReply({ content: 'No vanity role found. Run `/vanityrole setup` first.' });
        const role = interaction.guild.roles.cache.get(rec.roleId) || await interaction.guild.roles.fetch(rec.roleId).catch(() => null);
        if (!role) return interaction.editReply({ content: 'Your saved vanity role no longer exists. Run `/vanityrole setup` to recreate it.' });
        if (role.managed) return interaction.editReply({ content: 'Your vanity role is managed and cannot be edited.' });
        if (me.roles.highest.comparePositionTo(role) <= 0) return interaction.editReply({ content: 'My highest role must be above your vanity role.' });

        const hoist = interaction.options.getBoolean('hoist', true);
        const reason = `Vanity role display setting for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;
        try {
          await role.setHoist(hoist, reason);
        } catch (err) {
          return interaction.editReply({ content: 'Unable to update display setting. Make sure my role is above yours and I have Manage Roles.' });
        }
        await upsertUserRecord(interaction.guildId, interaction.user.id, { hoist });

        try { await modlog.log(interaction, 'Vanity Role Display Changed', {
          target: `${interaction.user.tag} (${interaction.user.id})`,
          reason: hoist ? 'Displaying role separately from online members' : 'Displaying role with online members',
          extraFields: [
            { name: 'Role', value: `${role} (${role.id})`, inline: false },
            { name: 'Displayed Separately', value: hoist ? 'yes' : 'no', inline: true },
          ],
        }); } catch (_) {}

        return interaction.editReply({
          content: hoist
            ? `Now displaying ${role} separately from online members.`
            : `Now displaying ${role} with the rest of the online members.`,
        });
      }

      if (sub === 'colour') {
        if (!rec?.roleId) return interaction.editReply({ content: 'No vanity role found. Run `/vanityrole setup` first.' });
        const role = interaction.guild.roles.cache.get(rec.roleId) || await interaction.guild.roles.fetch(rec.roleId).catch(() => null);
        if (!role) return interaction.editReply({ content: 'Your saved vanity role no longer exists. Run `/vanityrole setup` to recreate it.' });
        if (role.managed) return interaction.editReply({ content: 'Your vanity role is managed and cannot be edited.' });
        if (me.roles.highest.comparePositionTo(role) <= 0) return interaction.editReply({ content: 'My highest role must be above your vanity role.' });

        const use = interaction.options.getString('use', true);
        if (use === 'secondary' && !rec?.secondary) return interaction.editReply({ content: 'No secondary colour saved yet. Set it with `/vanityrole setup`.' });
        const picked = pickActiveColors(rec, use);
        if (!picked.primaryColor) {
          return interaction.editReply({ content: 'No colours saved yet. Set them with `/vanityrole setup`.' });
        }

        const reason = `Vanity role colour change for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;
        await role.setColors({
          primaryColor: picked.primaryColor,
          secondaryColor: picked.secondaryColor ?? null,
        }, reason);
        await upsertUserRecord(interaction.guildId, interaction.user.id, { active: picked.active });

        try { await modlog.log(interaction, 'Vanity Role Colour Changed', {
          target: `${interaction.user.tag} (${interaction.user.id})`,
          reason: `Set to ${picked.active}`,
          extraFields: [
            { name: 'Role', value: `${role} (${role.id})`, inline: false },
            { name: 'Primary', value: picked.primaryColor, inline: true },
            { name: 'Secondary', value: picked.secondaryColor || '(none)', inline: true },
          ],
        }); } catch (_) {}

        return interaction.editReply({
          content: `Updated ${role} colours to ${picked.primaryColor}${picked.secondaryColor ? ` → ${picked.secondaryColor}` : ''}.`,
        });
      }

      if (sub === 'name') {
        if (!rec?.roleId) return interaction.editReply({ content: 'No vanity role found. Run `/vanityrole setup` first.' });
        const role = interaction.guild.roles.cache.get(rec.roleId) || await interaction.guild.roles.fetch(rec.roleId).catch(() => null);
        if (!role) return interaction.editReply({ content: 'Your saved vanity role no longer exists. Run `/vanityrole setup` to recreate it.' });
        if (role.managed) return interaction.editReply({ content: 'Your vanity role is managed and cannot be edited.' });
        if (me.roles.highest.comparePositionTo(role) <= 0) return interaction.editReply({ content: 'My highest role must be above your vanity role.' });

        const value = interaction.options.getString('value', true).trim().slice(0, 100);
        const reason = `Vanity role rename for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;
        await role.setName(value, reason);

        try { await modlog.log(interaction, 'Vanity Role Renamed', {
          target: `${interaction.user.tag} (${interaction.user.id})`,
          reason: 'Renamed vanity role',
          extraFields: [
            { name: 'Role', value: `${role} (${role.id})`, inline: false },
            { name: 'New Name', value: value, inline: false },
          ],
        }); } catch (_) {}

        return interaction.editReply({ content: `Renamed your vanity role to **${value}**.` });
      }

      return interaction.editReply({ content: 'Unknown subcommand.' });
    } catch (err) {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: `Error: ${err.message || 'Unknown error'}` });
      }
      return interaction.reply({ content: `Error: ${err.message || 'Unknown error'}`, ephemeral: true });
    }
  },
  buildVanityRoleModal,
  handleVanityRoleModalSubmit,
};
