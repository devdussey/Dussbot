const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const modlog = require('../utils/modLogger');
const { getUserRecord, upsertUserRecord } = require('../utils/vanityRoleStore');

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

async function getOrCreateVanityRole({ interaction, member, me, rec, name, colors }) {
  const reason = `Vanity role for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;

  let role = null;
  if (rec?.roleId) {
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

async function ensureRolePositionAboveMember({ role, member, me, reason }) {
  let memberHighestOtherPosition = 0;
  for (const r of member.roles.cache.values()) {
    if (r.id === role.id) continue;
    if (r.position > memberHighestOtherPosition) memberHighestOtherPosition = r.position;
  }

  const maxAllowed = Math.max(1, me.roles.highest.position - 1);
  const desired = Math.max(1, Math.min(memberHighestOtherPosition + 1, maxAllowed));
  if (role.position === desired) return { desired, maxAllowed, memberHighestOtherPosition };

  try {
    await role.setPosition(desired, { reason });
  } catch (_) {
    // best-effort
  }

  return { desired, maxAllowed, memberHighestOtherPosition };
}

function buildVanityRoleModal(userId, rec) {
  const modal = new ModalBuilder()
    .setCustomId(`vanityrole:modal:${userId}`)
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

    const primaryIn = primaryRaw || null;
    const secondaryIn = secondaryRaw || null;

    const primary = primaryIn ? normalizeHex6(primaryIn) : null;
    const secondary = secondaryIn ? normalizeHex6(secondaryIn) : null;
    if (primaryIn && !primary) return interaction.editReply({ content: 'Invalid primary colour. Use a hex like `#5865F2`.' });
    if (secondaryIn && !secondary) return interaction.editReply({ content: 'Invalid secondary colour. Use a hex like `#5865F2`.' });

    const use = useRaw === 'secondary' ? 'secondary' : useRaw === 'primary' ? 'primary' : null;
    const merged = {
      roleId: rec?.roleId ?? null,
      primary: primaryIn ? primary : rec?.primary ?? null,
      secondary: secondaryIn ? secondary : rec?.secondary ?? null,
      active: use || rec?.active || 'primary',
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

    if (!member.roles.cache.has(role.id)) {
      try { await member.roles.add(role, reason); } catch (err) {
        throw new Error(`I created the role, but couldn't assign it to you: ${err.message || 'Unknown error'}`);
      }
    }

    const pos = await ensureRolePositionAboveMember({ role, member, me, reason });

    const saved = await upsertUserRecord(interaction.guildId, interaction.user.id, {
      roleId: role.id,
      primary: merged.primary,
      secondary: merged.secondary,
      active: picked.active,
    });

    try { await modlog.log(interaction, created ? 'Vanity Role Created' : 'Vanity Role Updated', {
      target: `${interaction.user.tag} (${interaction.user.id})`,
      reason: created ? 'Created vanity role' : 'Updated vanity role',
      extraFields: [
        { name: 'Role', value: `${role} (${role.id})`, inline: false },
        { name: 'Primary', value: saved.primary || 'not set', inline: true },
        { name: 'Secondary', value: saved.secondary || 'not set', inline: true },
        { name: 'Gradient Primary', value: saved.active, inline: true },
        { name: 'Position', value: `${role.position} (desired ${pos.desired})`, inline: true },
      ],
    }); } catch (_) {}

    const warning = (pos.desired < pos.memberHighestOtherPosition + 1)
      ? `\nNote: I could only place it as high as possible under my highest role (max position ${pos.maxAllowed}).`
      : '';

    return interaction.editReply({
      content: `${created ? 'Created' : 'Updated'} your vanity role: ${role}.${warning}`,
    });
  } catch (err) {
    return interaction.editReply({ content: `Error: ${err.message || 'Unknown error'}` });
  }
}

async function handleVanityRoleModalSubmit(interaction) {
  const nameRaw = (interaction.fields.getTextInputValue('vanityrole:name') || '').trim();
  const primaryRaw = (interaction.fields.getTextInputValue('vanityrole:primary') || '').trim();
  const secondaryRaw = (interaction.fields.getTextInputValue('vanityrole:secondary') || '').trim();

  return handleVanityRoleSetup(interaction, {
    name: nameRaw || null,
    primary: primaryRaw || null,
    secondary: secondaryRaw || null,
    use: null,
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
        const modal = buildVanityRoleModal(interaction.user.id, rec);
        try {
          await interaction.showModal(modal);
        } catch (_) {
          return interaction.reply({ content: 'Could not open the vanity role form. Please try again.', ephemeral: true });
        }
        return;
      }

      await interaction.deferReply({ ephemeral: true });

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
