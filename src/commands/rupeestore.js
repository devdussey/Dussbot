const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionsBitField,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const coinStore = require('../utils/coinStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const immunityStore = require('../utils/silenceImmunityStore');
const rupeeCustomRoleStore = require('../utils/rupeeCustomRoleStore');
const logSender = require('../utils/logSender');
const { buildRupeeSpendEmbed } = require('../utils/rupeeLogEmbed');

const SHOP_ITEMS = [
  {
    id: 'stfu',
    label: 'STFU',
    cost: 5,
    description: 'Silence any user for 5 minutes.',
    requireModeratorTarget: false,
    moderatorOnly: false,
    kind: 'timeout',
  },
  {
    id: 'abuse_mod',
    label: 'Abuse Mod',
    cost: 10,
    description: 'Silence a moderator for 5 minutes.',
    requireModeratorTarget: true,
    moderatorOnly: true,
    kind: 'timeout',
  },
  {
    id: 'muzzle',
    label: 'Muzzle',
    cost: 5,
    description: 'Mute a user across all voice channels for 5 minutes.',
    requireModeratorTarget: false,
    moderatorOnly: false,
    kind: 'muzzle',
  },
  {
    id: 'nickname',
    label: 'Nickname Change',
    cost: 10,
    description: 'Change your server nickname instantly.',
    kind: 'nickname',
  },
  {
    id: 'custom_role_solid',
    label: 'Custom Role — Solid',
    cost: 5,
    description: 'Create or refresh a hoisted custom role with a solid colour above your roles.',
    kind: 'custom_role',
    mode: 'solid',
  },
  {
    id: 'custom_role_gradient',
    label: 'Custom Role — Gradient',
    cost: 15,
    description: 'Create or refresh a hoisted custom role with gradient colours (server must support role icons).',
    kind: 'custom_role',
    mode: 'gradient',
  },
];

const TIMEOUT_DURATION_MS = 5 * 60_000;
const MUZZLE_DURATION_MS = 5 * 60_000;
const IMMUNITY_BUFFER_MS = 10 * 60_000; // After timeout ends
const ROLE_ICON_FEATURE = 'ROLE_ICONS'; // Needed for gradient role colours
const muzzleTimers = new Map();

function makeEmbed(guildId) {
  return new EmbedBuilder().setColor(resolveEmbedColour(guildId, 0x00f0ff));
}

function formatMinutes(ms) {
  const mins = Math.ceil(Math.max(0, ms) / 60_000);
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

function formatBlessingStatus(guildId, userId) {
  const status = coinStore.getPrayStatus(guildId, userId);
  if (status.canPray) return '✅ Ready — use `/blessing` to claim 1 rupee.';
  const mins = Math.ceil(status.cooldownMs / 60_000);
  return `⌛ Available in ${mins} minute${mins === 1 ? '' : 's'}.`;
}

function normalizeHex6(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  return `#${m[1].toUpperCase()}`;
}

function buildDefaultRoleName(member) {
  const base = (member?.displayName || member?.nickname || member?.user?.username || member?.user?.tag || 'Member')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 90) || 'Member';
  return `${base}'s Custom Role`.slice(0, 100);
}

function buildShopEmbed({ guildId, balance, selectedItemId = null, blessingStatus }) {
  const embed = makeEmbed(guildId)
    .setTitle('🏪 Rupee Store')
    .setDescription(
      'Spend your rupees on moderation toys and cosmetic perks. Choose an item to see what it does, then follow the prompts.\n' +
      `**Your balance:** ${balance} rupee${balance === 1 ? '' : 's'}.`
    )
    .addFields({ name: 'Blessing status', value: blessingStatus });

  SHOP_ITEMS.forEach(item => {
    const prefix = item.id === selectedItemId ? '👉 ' : '';
    embed.addFields({
      name: `${prefix}${item.label} — ${item.cost} rupee${item.cost === 1 ? '' : 's'}`,
      value: item.description,
      inline: false,
    });
  });

  embed.setFooter({ text: 'Targets gain 10 minutes of immunity after timeouts or muzzles expire.' });

  return embed;
}

function getMuzzleKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function scheduleMuzzleLift(client, guildId, userId, durationMs, reason) {
  const key = getMuzzleKey(guildId, userId);
  if (muzzleTimers.has(key)) {
    clearTimeout(muzzleTimers.get(key));
  }
  const timer = setTimeout(async () => {
    muzzleTimers.delete(key);
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member?.voice?.serverMute) {
        await member.voice.setMute(false, reason);
      }
    } catch (err) {
      console.error('Failed to lift muzzle:', err?.message || err);
    }
  }, durationMs);
  muzzleTimers.set(key, timer);
}

async function logRupeeStorePurchase({ interaction, itemLabel, cost, target, balance }) {
  if (!interaction?.guildId || !interaction?.client) return;
  try {
    const embed = buildRupeeSpendEmbed({
      guildId: interaction.guildId,
      actor: interaction.user,
      itemLabel,
      itemCost: cost,
      target,
      balance,
    });
    await logSender.sendLog({
      guildId: interaction.guildId,
      logType: 'rupee_spend',
      embed,
      client: interaction.client,
    });
  } catch (err) {
    console.error('Failed to send rupee spend log:', err?.message || err);
  }
}

function buildItemSelect(customId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Choose a rupee item to purchase')
      .setDisabled(disabled)
      .addOptions(
        SHOP_ITEMS.map(item => ({
          label: item.label,
          description: item.description.slice(0, 100),
          value: item.id,
        })),
      ),
  );
}

function buildUserSelect(customId, disabled = true, placeholder = 'Select an item first') {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setDisabled(disabled)
      .setMaxValues(1)
      .setMinValues(1),
  );
}

function buildModeratorSelect(customId, moderators, disabled = false) {
  const options = moderators.slice(0, 25).map(member => ({
    label: member.displayName || member.user.username || member.id,
    value: member.id,
    description: member.user.tag,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(options.length ? 'Pick a moderator target' : 'No moderators available')
      .setDisabled(disabled || options.length === 0)
      .addOptions(options.length ? options : [{ label: 'No moderators available', value: 'none', description: 'Nobody to target', default: true }]),
  );
}

function findItem(itemId) {
  return SHOP_ITEMS.find(item => item.id === itemId);
}

async function applyTimeoutPurchase({ interaction, item, targetMember }) {
  const guild = interaction.guild;
  const actor = interaction.user;
  const me = guild.members.me;

  if (!me?.permissions?.has(PermissionsBitField.Flags.ModerateMembers)) {
    return { error: 'I need the Moderate Members permission to apply timeouts.' };
  }

  if (actor.id === targetMember.id) {
    return { error: 'You cannot target yourself.' };
  }
  if (targetMember.user.bot) {
    return { error: 'Bots cannot be targeted with this item.' };
  }

  const isAdminTarget = targetMember.permissions.has(PermissionsBitField.Flags.Administrator);
  if (isAdminTarget) {
    return { error: 'This item cannot be used on administrators.' };
  }

  const isModeratorTarget = targetMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)
    || targetMember.permissions.has(PermissionsBitField.Flags.ManageMessages);

  if (item.requireModeratorTarget && !isModeratorTarget) {
    return { error: 'Abuse Mod can only be used on moderators.' };
  }

  const remainingMs = immunityStore.getRemainingMs(guild.id, targetMember.id);
  if (remainingMs > 0) {
    return { blockedMs: remainingMs };
  }

  const meHigher = me.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
  if (!meHigher || !targetMember.moderatable) {
    return { error: 'I cannot timeout that member due to role hierarchy or permissions.' };
  }

  const paid = await rupeeStore.spendTokens(guild.id, actor.id, item.cost);
  if (!paid) {
    const balance = rupeeStore.getBalance(guild.id, actor.id);
    return { error: `You need ${item.cost} rupee${item.cost === 1 ? '' : 's'} to buy ${item.label}. Balance: ${balance}.` };
  }

  const reason = `${item.label} purchased by ${actor.tag} (${actor.id})`;

  try {
    await targetMember.timeout(TIMEOUT_DURATION_MS, reason);
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, item.cost);
    return { error: 'Failed to apply the timeout. Your rupees were refunded.' };
  }

  await immunityStore.recordSilence(guild.id, targetMember.id, TIMEOUT_DURATION_MS, IMMUNITY_BUFFER_MS);

  const newBalance = rupeeStore.getBalance(guild.id, actor.id);
  return { success: true, newBalance };
}

async function applyMuzzlePurchase({ interaction, item, targetMember }) {
  const guild = interaction.guild;
  const actor = interaction.user;
  const me = guild.members.me;

  if (!me?.permissions?.has(PermissionsBitField.Flags.MuteMembers)) {
    return { error: 'I need the Mute Members permission to muzzle members.' };
  }

  if (actor.id === targetMember.id) {
    return { error: 'You cannot target yourself.' };
  }
  if (targetMember.user.bot) {
    return { error: 'Bots cannot be targeted with this item.' };
  }

  const isAdminTarget = targetMember.permissions.has(PermissionsBitField.Flags.Administrator);
  if (isAdminTarget) {
    return { error: 'This item cannot be used on administrators.' };
  }

  const remainingMs = immunityStore.getRemainingMs(guild.id, targetMember.id);
  if (remainingMs > 0) {
    return { blockedMs: remainingMs };
  }

  const meHigher = me.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
  if (!meHigher || !targetMember.moderatable) {
    return { error: 'I cannot muzzle that member due to role hierarchy or permissions.' };
  }

  if (!targetMember.voice?.channelId) {
    return { error: 'That user must be connected to a voice channel to be muzzled.' };
  }

  const paid = await rupeeStore.spendTokens(guild.id, actor.id, item.cost);
  if (!paid) {
    const balance = rupeeStore.getBalance(guild.id, actor.id);
    return { error: `You need ${item.cost} rupee${item.cost === 1 ? '' : 's'} to buy ${item.label}. Balance: ${balance}.` };
  }

  const reason = `Muzzle purchased by ${actor.tag} (${actor.id})`;
  try {
    await targetMember.voice.setMute(true, reason);
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, item.cost);
    return { error: 'Failed to apply the muzzle. Your rupees were refunded.' };
  }

  scheduleMuzzleLift(interaction.client, guild.id, targetMember.id, MUZZLE_DURATION_MS, reason);
  await immunityStore.recordSilence(guild.id, targetMember.id, MUZZLE_DURATION_MS, IMMUNITY_BUFFER_MS);

  const newBalance = rupeeStore.getBalance(guild.id, actor.id);
  return { success: true, newBalance };
}

function computeDesiredRolePosition(me, targetMember) {
  if (!me?.roles?.highest) return null;
  const maxAllowed = me.roles.highest.position - 1;
  if (maxAllowed < 1) return null;
  const highestUserRole = targetMember?.roles?.highest;
  const desired = (highestUserRole?.position ?? 0) + 1;
  if (desired > maxAllowed) return maxAllowed;
  return Math.max(1, desired);
}

async function ensureRolePosition(role, position, reason) {
  if (!role || typeof position !== 'number' || position < 1) return role;
  if (typeof role.position === 'number' && role.position === position) return role;
  try {
    return await role.setPosition(position, reason);
  } catch (err) {
    throw new Error(`Failed to position the custom role: ${err.message || err}`);
  }
}

async function applyNicknamePurchase({ interaction, newNickname, cost }) {
  const guild = interaction.guild;
  const actor = interaction.user;
  const me = guild.members.me;

  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageNicknames)) {
    return { error: 'I need the Manage Nicknames permission to change your nickname.' };
  }

  let member;
  try {
    member = await guild.members.fetch(actor.id);
  } catch (_) {
    return { error: 'Could not fetch your member record. Try again.' };
  }

  if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return { error: 'Move my highest role above yours so I can change your nickname.' };
  }

  const paid = await rupeeStore.spendTokens(guild.id, actor.id, cost);
  if (!paid) {
    const balance = rupeeStore.getBalance(guild.id, actor.id);
    return { error: `You need ${cost} rupees for Nickname Change. Balance: ${balance}.` };
  }

  const reason = `Nickname Change purchased by ${actor.tag} (${actor.id})`;
  try {
    await member.setNickname(newNickname, reason);
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, cost);
    return { error: `Failed to change nickname: ${err.message || err}` };
  }

  const newBalance = rupeeStore.getBalance(guild.id, actor.id);
  return { success: true, newBalance };
}

async function applyCustomRolePurchase({ interaction, mode, colors, roleName, cost }) {
  const guild = interaction.guild;
  const actor = interaction.user;
  const me = guild.members.me;

  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return { error: 'I need the Manage Roles permission to create or edit your custom role.' };
  }

  let member;
  try {
    member = await guild.members.fetch(actor.id);
  } catch (_) {
    return { error: 'Could not fetch your member record. Try again.' };
  }

  if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return { error: 'Move my highest role above yours so I can manage your custom role.' };
  }

  if (mode === 'gradient') {
    const features = Array.isArray(guild?.features) ? guild.features : [];
    if (!features.includes(ROLE_ICON_FEATURE)) {
      return { error: 'This server does not support gradient role colours (role icons feature required).' };
    }
  }

  const paid = await rupeeStore.spendTokens(guild.id, actor.id, cost);
  if (!paid) {
    const balance = rupeeStore.getBalance(guild.id, actor.id);
    return { error: `You need ${cost} rupees for this custom role. Balance: ${balance}.` };
  }

  const desiredPosition = computeDesiredRolePosition(me, member);
  if (!desiredPosition) {
    await rupeeStore.addTokens(guild.id, actor.id, cost);
    return { error: 'I cannot place a custom role above your roles. Move my role higher and try again.' };
  }

  let record = null;
  try {
    record = await rupeeCustomRoleStore.get(interaction.guildId, actor.id);
  } catch (_) {}

  let role = null;
  if (record?.roleId) {
    try {
      role = await guild.roles.fetch(record.roleId);
    } catch (_) {
      role = null;
    }
    if (role && me.roles.highest.comparePositionTo(role) <= 0) {
      await rupeeStore.addTokens(guild.id, actor.id, cost);
      return { error: 'My highest role must stay above your custom role. Move it up and retry.' };
    }
  }

  const reason = `Custom role (${mode}) purchased by ${actor.tag} (${actor.id})`;
  const safeName = roleName?.trim() ? roleName.trim().slice(0, 100) : buildDefaultRoleName(member);

  if (!role) {
    try {
      role = await guild.roles.create({
        name: safeName,
        hoist: true,
        mentionable: false,
        permissions: [],
        color: mode === 'solid' ? colors[0] : undefined,
        reason,
      });
    } catch (err) {
      await rupeeStore.addTokens(guild.id, actor.id, cost);
      return { error: `Failed to create custom role: ${err.message || err}` };
    }
  }

  try {
    role = await ensureRolePosition(role, desiredPosition, reason);
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, cost);
    return { error: err.message || String(err) };
  }

  // Ensure hoisted and no permissions
  try {
    if (!role.hoist) {
      await role.setHoist(true, reason);
    }
    if (role.permissions.bitfield !== 0n) {
      await role.setPermissions(0n, reason);
    }
    if (role.name !== safeName) {
      await role.setName(safeName, reason);
    }
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, cost);
    return { error: `Failed to update custom role basics: ${err.message || err}` };
  }

  // Apply colour
  try {
    if (mode === 'solid') {
      await role.setColor(colors[0], reason);
    } else {
      await role.setColors({ primaryColor: colors[0], secondaryColor: colors[1] }, reason);
    }
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, cost);
    return { error: `Failed to apply role colour: ${err.message || err}` };
  }

  // Ensure assignment
  try {
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, reason);
    }
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, cost);
    return { error: `Failed to assign your custom role: ${err.message || err}` };
  }

  await rupeeCustomRoleStore.set(interaction.guildId, actor.id, {
    roleId: role.id,
    mode,
    colors,
    name: safeName,
  });

  const newBalance = rupeeStore.getBalance(guild.id, actor.id);
  return { success: true, newBalance, role };
}

async function getModerators(guild) {
  try {
    const members = await guild.members.fetch();
    return members.filter(m =>
      !m.user.bot &&
      !m.permissions.has(PermissionsBitField.Flags.Administrator) &&
      (m.permissions.has(PermissionsBitField.Flags.ModerateMembers) || m.permissions.has(PermissionsBitField.Flags.ManageMessages))
    ).toJSON();
  } catch (_) {
    return [];
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rupeestore')
    .setDescription('Browse and spend rupees on special items'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      const embed = makeEmbed(interaction.guildId)
        .setTitle('Use this in a server')
        .setDescription('The Rupee Store can only be opened inside a server.');
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const balance = rupeeStore.getBalance(guildId, userId);
    const blessingStatus = formatBlessingStatus(guildId, userId);

    const selectId = `rupeestore-select-${interaction.id}`;
    const targetSelectBase = `rupeestore-target-${interaction.id}`;

    const embed = buildShopEmbed({ guildId, balance, blessingStatus });
    const itemRow = buildItemSelect(selectId, false);
    const userRow = buildUserSelect(targetSelectBase, true);

    const reply = await interaction.reply({
      embeds: [embed],
      components: [itemRow, userRow],
      ephemeral: true,
    });

    const collector = reply.createMessageComponentCollector({ time: 5 * 60_000 });

    collector.on('collect', async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        await componentInteraction.reply({ content: 'This store session belongs to someone else.', ephemeral: true });
        return;
      }

      if (componentInteraction.isStringSelectMenu() && componentInteraction.customId === selectId) {
        const itemId = componentInteraction.values[0];
        const selectedItem = findItem(itemId);
        if (!selectedItem) {
          await componentInteraction.reply({ content: 'That item is unavailable.', ephemeral: true });
          return;
        }

        const freshBalance = rupeeStore.getBalance(guildId, interaction.user.id);
        const freshBlessing = formatBlessingStatus(guildId, userId);
        const updatedEmbed = buildShopEmbed({
          guildId,
          balance: freshBalance,
          selectedItemId: itemId,
          blessingStatus: freshBlessing,
        });
        const freshItemRow = buildItemSelect(selectId, false);

        if (selectedItem.kind === 'timeout' || selectedItem.kind === 'muzzle') {
          if (selectedItem.moderatorOnly) {
            const moderators = await getModerators(interaction.guild);
            const modRow = buildModeratorSelect(`${targetSelectBase}:${itemId}`, moderators, false);
            await componentInteraction.update({
              embeds: [updatedEmbed],
              components: [freshItemRow, modRow],
            });
          } else {
            const placeholder = selectedItem.kind === 'muzzle'
              ? 'Pick a target to muzzle'
              : `Pick a target for ${selectedItem.label}`;
            const enabledUserRow = buildUserSelect(`${targetSelectBase}:${itemId}`, false, placeholder);
            await componentInteraction.update({
              embeds: [updatedEmbed],
              components: [freshItemRow, enabledUserRow],
            });
          }
          return;
        }

        if (selectedItem.kind === 'nickname') {
          const modalId = `rupeestore-nick-${interaction.id}`;
          const modal = new ModalBuilder()
            .setCustomId(modalId)
            .setTitle('Nickname Change')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('nickname')
                  .setLabel('New nickname')
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(32)
                  .setMinLength(1)
                  .setPlaceholder('Type your new nickname')
                  .setRequired(true),
              ),
            );

          await componentInteraction.showModal(modal);

          let submission;
          try {
            submission = await componentInteraction.awaitModalSubmit({
              time: 120_000,
              filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            });
          } catch (_) {
            return;
          }

          const nicknameRaw = submission.fields.getTextInputValue('nickname') || '';
          const nickname = nicknameRaw.trim().slice(0, 32);
          if (!nickname) {
            await submission.reply({ content: 'Please enter a valid nickname.', ephemeral: true });
            return;
          }

          const result = await applyNicknamePurchase({
            interaction,
            newNickname: nickname,
            cost: selectedItem.cost,
          });

          if (result.error) {
            await submission.reply({ content: result.error, ephemeral: true });
            return;
          }

          const successEmbed = makeEmbed(guildId)
            .setTitle('Nickname updated')
            .setDescription(
              `Your nickname has been changed to **${escapeMarkdown(nickname)}**.\n` +
              `Remaining balance: ${result.newBalance} rupee${result.newBalance === 1 ? '' : 's'}.`
            );
          await submission.reply({ embeds: [successEmbed], ephemeral: true });

          await logRupeeStorePurchase({
            interaction,
            itemLabel: selectedItem.label,
            cost: selectedItem.cost,
            target: interaction.user,
            balance: Number.isFinite(result.newBalance) ? result.newBalance : rupeeStore.getBalance(guildId, interaction.user.id),
          });

          const refreshedEmbed = buildShopEmbed({
            guildId,
            balance: rupeeStore.getBalance(guildId, interaction.user.id),
            blessingStatus: formatBlessingStatus(guildId, userId),
          });
          const resetUserRow = buildUserSelect(targetSelectBase, true);
          await interaction.editReply({
            embeds: [refreshedEmbed],
            components: [freshItemRow, resetUserRow],
          });
          return;
        }

        if (selectedItem.kind === 'custom_role') {
          const modalId = `rupeestore-role-${selectedItem.id}-${interaction.id}`;
          const modal = new ModalBuilder()
            .setCustomId(modalId)
            .setTitle(selectedItem.label)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('role_name')
                  .setLabel('Role name (optional)')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(100)
                  .setPlaceholder("e.g. Aurora's Flair"),
              ),
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('color_primary')
                  .setLabel(selectedItem.mode === 'gradient' ? 'Primary colour (#RRGGBB)' : 'Colour (#RRGGBB)')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(7)
                  .setPlaceholder('#FF00AA'),
              ),
              ...(selectedItem.mode === 'gradient'
                ? [
                    new ActionRowBuilder().addComponents(
                      new TextInputBuilder()
                        .setCustomId('color_secondary')
                        .setLabel('Secondary colour (#RRGGBB)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(7)
                        .setPlaceholder('#00FFC8'),
                    ),
                  ]
                : []),
            );

          await componentInteraction.showModal(modal);

          let submission;
          try {
            submission = await componentInteraction.awaitModalSubmit({
              time: 180_000,
              filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            });
          } catch (_) {
            return;
          }

          const nameInput = submission.fields.getTextInputValue('role_name') || '';
          const primaryRaw = submission.fields.getTextInputValue('color_primary') || '';
          const secondaryRaw = selectedItem.mode === 'gradient'
            ? submission.fields.getTextInputValue('color_secondary') || ''
            : null;

          const primary = normalizeHex6(primaryRaw);
          const secondary = selectedItem.mode === 'gradient' ? normalizeHex6(secondaryRaw) : null;

          if (!primary || (selectedItem.mode === 'gradient' && !secondary)) {
            await submission.reply({ content: 'Please provide valid hex colours like #A1B2C3.', ephemeral: true });
            return;
          }

          await submission.deferReply({ ephemeral: true });

          const result = await applyCustomRolePurchase({
            interaction,
            mode: selectedItem.mode,
            colors: selectedItem.mode === 'gradient' ? [primary, secondary] : [primary],
            roleName: nameInput,
            cost: selectedItem.cost,
          });

          if (result.error) {
            await submission.editReply({ content: result.error });
            return;
          }

          const roleMention = result.role ? `<@&${result.role.id}>` : 'your custom role';
          await submission.editReply({
            content: `✅ ${selectedItem.label} applied to ${roleMention}.\nRemaining balance: ${result.newBalance} rupee${result.newBalance === 1 ? '' : 's'}.`,
          });

          await logRupeeStorePurchase({
            interaction,
            itemLabel: selectedItem.label,
            cost: selectedItem.cost,
            target: interaction.user,
            balance: Number.isFinite(result.newBalance) ? result.newBalance : rupeeStore.getBalance(guildId, interaction.user.id),
          });

          const refreshedEmbed = buildShopEmbed({
            guildId,
            balance: rupeeStore.getBalance(guildId, interaction.user.id),
            blessingStatus: formatBlessingStatus(guildId, userId),
          });
          const resetUserRow = buildUserSelect(targetSelectBase, true);
          await interaction.editReply({
            embeds: [refreshedEmbed],
            components: [freshItemRow, resetUserRow],
          });
          return;
        }

        return;
      }

      if (componentInteraction.customId.startsWith(targetSelectBase)) {
        const parts = componentInteraction.customId.split(':');
        const itemId = parts[1];
        const selectedItem = findItem(itemId);
        if (!selectedItem) {
          await componentInteraction.reply({ content: 'That item is no longer available.', ephemeral: true });
          return;
        }

        if (selectedItem.kind !== 'timeout' && selectedItem.kind !== 'muzzle') {
          await componentInteraction.reply({ content: 'This item no longer requires a target.', ephemeral: true });
          return;
        }

        let targetId = null;
        if (componentInteraction.isUserSelectMenu()) {
          targetId = componentInteraction.values?.[0];
        } else if (componentInteraction.isStringSelectMenu()) {
          targetId = componentInteraction.values?.[0];
        }
        if (!targetId || targetId === 'none') {
          await componentInteraction.reply({ content: 'Please pick a valid target.', ephemeral: true });
          return;
        }

        let targetMember;
        try {
          targetMember = await interaction.guild.members.fetch(targetId);
        } catch (_) {
          await componentInteraction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
          return;
        }

        const applyFn = selectedItem.kind === 'timeout'
          ? applyTimeoutPurchase
          : applyMuzzlePurchase;
        const result = await applyFn({
          interaction,
          item: selectedItem,
          targetMember,
        });

        if (result.blockedMs) {
          const blockVerb = selectedItem.kind === 'muzzle' ? 'can\'t be muzzled' : 'can\'t be silenced';
          const embed = makeEmbed(guildId)
            .setTitle('Target is immune')
            .setDescription(
              `${targetMember.displayName || targetMember.user.username} ${blockVerb} for ${formatMinutes(result.blockedMs)}.`
            );
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        if (result.error) {
          const embed = makeEmbed(guildId)
            .setTitle('Purchase failed')
            .setDescription(result.error);
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        const durationMs = selectedItem.kind === 'timeout' ? TIMEOUT_DURATION_MS : MUZZLE_DURATION_MS;
        const successEmbed = makeEmbed(guildId)
          .setTitle(`${selectedItem.label} applied`)
          .setDescription(
            `${selectedItem.label} used on ${targetMember} for ${formatMinutes(durationMs)}.\n` +
            `Remaining balance: ${result.newBalance} rupee${result.newBalance === 1 ? '' : 's'}.`
          );
        await componentInteraction.reply({ embeds: [successEmbed], ephemeral: true });

        const isMuzzle = selectedItem.kind === 'muzzle';
        const publicEmbed = makeEmbed(guildId)
          .setTitle(isMuzzle ? 'Muzzle deployed' : `${selectedItem.label} deployed`)
          .setDescription(
            isMuzzle
              ? `${interaction.user} has muzzled ${targetMember} for ${formatMinutes(durationMs)}.`
              : `${interaction.user} used **${selectedItem.label}** on ${targetMember} for ${formatMinutes(durationMs)}.`
          )
          .setThumbnail(targetMember.displayAvatarURL({ extension: 'png', size: 256 }))
          .setFooter({
            text: isMuzzle
              ? 'Target is immune for 10 minutes after the muzzle ends.'
              : 'Targets gain 10 minutes of immunity after their timeout ends.',
          });

        await interaction.channel?.send({
          embeds: [publicEmbed],
          allowedMentions: { users: [interaction.user.id, targetMember.id] },
        }).catch(() => {});

        const freshBalance = rupeeStore.getBalance(guildId, interaction.user.id);
        const freshBlessing = formatBlessingStatus(guildId, userId);
        await logRupeeStorePurchase({
          interaction,
          itemLabel: selectedItem.label,
          cost: selectedItem.cost,
          target: targetMember,
          balance: freshBalance,
        });
        const refreshedEmbed = buildShopEmbed({
          guildId,
          balance: freshBalance,
          blessingStatus: freshBlessing,
        });
        const freshItemRow = buildItemSelect(selectId, false);
        const resetUserRow = buildUserSelect(targetSelectBase, true);

        await interaction.editReply({
          embeds: [refreshedEmbed],
          components: [freshItemRow, resetUserRow],
        });
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({
          components: [],
        });
      } catch (_) {}
    });
  },
};
