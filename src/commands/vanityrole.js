const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
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

function pickActiveColour(rec, which) {
  const active = which || rec?.active || 'primary';
  const value = active === 'secondary' ? rec?.secondary : rec?.primary;
  return { active, value: typeof value === 'string' ? value : null };
}

async function getOrCreateVanityRole({ interaction, member, me, rec, name, colour }) {
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
  const createdRole = await interaction.guild.roles.create({
    name: roleName,
    color: colour ?? undefined,
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vanityrole')
    .setDescription('Create and manage your vanity role (admins only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Create or update your vanity role')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Role name (optional)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('primary')
            .setDescription('Primary hex colour (e.g., #5865F2 or 5865F2)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('secondary')
            .setDescription('Secondary hex colour (optional)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('use')
            .setDescription('Which saved colour to apply now')
            .addChoices(
              { name: 'primary', value: 'primary' },
              { name: 'secondary', value: 'secondary' },
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('colour')
        .setDescription('Switch your vanity role colour between your two saved hex codes')
        .addStringOption(opt =>
          opt.setName('use')
            .setDescription('Which colour to apply')
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

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
    }

    const member = interaction.member;
    if (!member || !member.roles) {
      return interaction.reply({ content: 'Could not resolve your member record. Try again.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    const rec = getUserRecord(interaction.guildId, interaction.user.id);

    try {
      if (sub === 'setup') {
        const name = interaction.options.getString('name')?.trim() || null;
        const primaryIn = interaction.options.getString('primary');
        const secondaryIn = interaction.options.getString('secondary');
        const use = interaction.options.getString('use') || null;

        const primary = primaryIn ? normalizeHex6(primaryIn) : null;
        const secondary = secondaryIn ? normalizeHex6(secondaryIn) : null;
        if (primaryIn && !primary) return interaction.editReply({ content: 'Invalid primary colour. Use a hex like `#5865F2`.' });
        if (secondaryIn && !secondary) return interaction.editReply({ content: 'Invalid secondary colour. Use a hex like `#5865F2`.' });

        const merged = {
          roleId: rec?.roleId ?? null,
          primary: primary ?? rec?.primary ?? null,
          secondary: secondary ?? rec?.secondary ?? null,
          active: (use === 'secondary' ? 'secondary' : use === 'primary' ? 'primary' : rec?.active) || 'primary',
        };

        const picked = pickActiveColour(merged, merged.active);
        const { role, created, reason } = await getOrCreateVanityRole({
          interaction,
          member,
          me,
          rec: merged,
          name,
          colour: picked.value,
        });

        if (name) {
          try { await role.setName(name.slice(0, 100), reason); } catch (_) {}
        }
        if (picked.value) {
          try { await role.setColor(picked.value, reason); } catch (_) {}
        }

        // Ensure assignment
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
            { name: 'Active', value: saved.active, inline: true },
            { name: 'Position', value: `${role.position} (desired ${pos.desired})`, inline: true },
          ],
        }); } catch (_) {}

        const warning = (pos.desired < pos.memberHighestOtherPosition + 1)
          ? `\nNote: I could only place it as high as possible under my highest role (max position ${pos.maxAllowed}).`
          : '';

        return interaction.editReply({
          content: `${created ? 'Created' : 'Updated'} your vanity role: ${role}.${warning}`,
        });
      }

      if (sub === 'colour') {
        if (!rec?.roleId) return interaction.editReply({ content: 'No vanity role found. Run `/vanityrole setup` first.' });
        const role = interaction.guild.roles.cache.get(rec.roleId) || await interaction.guild.roles.fetch(rec.roleId).catch(() => null);
        if (!role) return interaction.editReply({ content: 'Your saved vanity role no longer exists. Run `/vanityrole setup` to recreate it.' });
        if (role.managed) return interaction.editReply({ content: 'Your vanity role is managed and cannot be edited.' });
        if (me.roles.highest.comparePositionTo(role) <= 0) return interaction.editReply({ content: 'My highest role must be above your vanity role.' });

        const use = interaction.options.getString('use', true);
        const picked = pickActiveColour(rec, use);
        if (!picked.value) {
          return interaction.editReply({ content: `No ${picked.active} colour saved yet. Set it with \`/vanityrole setup\`.` });
        }

        const reason = `Vanity role colour change for ${interaction.user.tag} (${interaction.user.id}) via /vanityrole`;
        await role.setColor(picked.value, reason);
        await upsertUserRecord(interaction.guildId, interaction.user.id, { active: picked.active });

        try { await modlog.log(interaction, 'Vanity Role Colour Changed', {
          target: `${interaction.user.tag} (${interaction.user.id})`,
          reason: `Set to ${picked.active}`,
          extraFields: [
            { name: 'Role', value: `${role} (${role.id})`, inline: false },
            { name: 'Colour', value: picked.value, inline: true },
          ],
        }); } catch (_) {}

        return interaction.editReply({ content: `Updated ${role} colour to ${picked.value} (${picked.active}).` });
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
      return interaction.editReply({ content: `Error: ${err.message || 'Unknown error'}` });
    }
  },
};

