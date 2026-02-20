const cmdLogger = require('../utils/logger')('rupeestore');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionsBitField,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  escapeMarkdown,
} = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const coinStore = require('../utils/coinStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const immunityStore = require('../utils/silenceImmunityStore');
const rupeeCustomRoleStore = require('../utils/rupeeCustomRoleStore');
const logSender = require('../utils/logSender');
const { buildRupeeSpendEmbed } = require('../utils/rupeeLogEmbed');
const smiteConfigStore = require('../utils/smiteConfigStore');
const modLogStore = require('../utils/modLogStore');
const { getCurrencyName, formatCurrencyAmount, formatCurrencyWord } = require('../utils/currencyName');

const SHOP_ITEMS = [
  {
    id: 'stfu',
    label: 'STFU',
    cost: 5,
    description: 'Time out any non staff user for 5 minutes.',
    kind: 'timeout',
  },
  {
    id: 'muzzle',
    label: 'Muzzle',
    cost: 5,
    description: 'Mute a users voice permissions across the whole server for 5 minutes.',
    kind: 'muzzle',
  },
  {
    id: 'abuse_mod',
    label: 'Abuse Mod',
    cost: 15,
    description: 'Mute a mod as a non staff for 5 minutes.',
    kind: 'timeout',
  },
  {
    id: 'nickname',
    label: 'Nickname',
    cost: 5,
    description: 'Change your server nickname.',
    kind: 'nickname',
  },
  {
    id: 'nickname_member',
    label: 'Nickname Another Member',
    cost: 10,
    description: 'Change another members nickname. (Non Staff)',
    kind: 'nickname_member',
  },
  {
    id: 'custom_role_solid',
    label: 'Custom Role w/ Solid Colour',
    cost: 5,
    description: 'Please have the hex code of your desired colour ready.',
    kind: 'custom_role',
    mode: 'solid',
  },
  {
    id: 'custom_role_gradient',
    label: 'Custom Role w/ Gradient',
    cost: 15,
    description: 'Please have both your hex codes ready.',
    kind: 'custom_role',
    mode: 'gradient',
  },
  {
    id: 'everyone_ping',
    label: 'Guilt Free @everyone ping with message',
    cost: 15,
    description: 'Post a custom @everyone message in the configured main chat. (Posts as the bot)',
    kind: 'everyone_ping',
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

function truncateForEmbed(value, max = 1024) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(1, max - 3))}...`;
}

function formatBlessingStatus(guildId, userId) {
  const status = coinStore.getPrayStatus(guildId, userId);
  if (status.canPray) return `✅ Ready — use \`/blessing\` to claim ${formatCurrencyAmount(guildId, 1, { lowercase: true })}.`;
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

function resolveShopItemsForGuild(guildId) {
  const config = smiteConfigStore.getConfig(guildId);
  const storeItemCosts = config?.storeItemCosts && typeof config.storeItemCosts === 'object'
    ? config.storeItemCosts
    : {};
  const configuredItemIds = Array.isArray(config?.storeItemIds)
    ? config.storeItemIds
    : SHOP_ITEMS.map(item => item.id);
  const enabledItemIds = new Set(configuredItemIds.map(id => String(id)));

  return SHOP_ITEMS
    .filter(item => enabledItemIds.has(item.id))
    .map((item) => {
    const raw = storeItemCosts[item.id];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return { ...item };
    const cost = Math.floor(parsed);
    if (cost < 1) return { ...item };
    return { ...item, cost };
    });
}

function buildShopEmbed({ guildId, balance, selectedItemId = null, blessingStatus, shopItems }) {
  const currencyName = getCurrencyName(guildId);
  const embed = makeEmbed(guildId)
    .setTitle(`🏪 ${currencyName} Store`)
    .setDescription(
      `Spend your ${formatCurrencyWord(guildId, 2, { lowercase: true })} on moderation toys and cosmetic perks. Choose an item to see what it does, then follow the prompts.\n` +
      `**Your balance:** ${formatCurrencyAmount(guildId, balance, { lowercase: true })}.`
    )
    .addFields({ name: 'Blessing status', value: blessingStatus });

  shopItems.forEach(item => {
    const prefix = item.id === selectedItemId ? '👉 ' : '';
    embed.addFields({
      name: `${prefix}${item.label} — ${formatCurrencyAmount(guildId, item.cost, { lowercase: true })}`,
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
      cmdLogger.error('Failed to lift muzzle:', err?.message || err);
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
    cmdLogger.error('Failed to send rupee spend log:', err?.message || err);
  }
}

function logStorePurchaseError(interaction, reason, extra = {}) {
  cmdLogger.error('Rupee store purchase error', {
    guildId: interaction?.guildId || null,
    userId: interaction?.user?.id || null,
    reason,
    ...extra,
  });
}

function buildItemSelect(customId, shopItems, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Choose an item to purchase')
      .setDisabled(disabled)
      .addOptions(
        shopItems.map(item => ({
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

function findItem(itemId, shopItems) {
  return shopItems.find(item => item.id === itemId);
}

async function getModeratorRoleId(guildId) {
  try {
    const id = await modLogStore.getModeratorRole(guildId);
    return id ? String(id) : null;
  } catch (_) {
    return null;
  }
}

function hasModeratorRole(member, modRoleId) {
  return Boolean(member && modRoleId && member.roles?.cache?.has(modRoleId));
}

function isStaffMember(member, modRoleId) {
  if (!member) return false;
  const isAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator);
  return Boolean(isAdmin || hasModeratorRole(member, modRoleId));
}

async function applyTimeoutPurchase({ interaction, item, targetMember, modRoleId }) {
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

  if (item.id === 'stfu' && hasModeratorRole(targetMember, modRoleId)) {
    return { error: 'STFU cannot be used on moderators.' };
  }

  if (item.id === 'abuse_mod') {
    if (!modRoleId) {
      return { error: 'No moderator role is configured. Run /modconfig first.' };
    }
    const actorMember = await guild.members.fetch(actor.id).catch(() => null);
    if (isStaffMember(actorMember, modRoleId)) {
      return { error: 'Abuse Mod can only be purchased by non-staff users.' };
    }
    if (!hasModeratorRole(targetMember, modRoleId)) {
      return { error: 'Abuse Mod can only target members with the configured moderator role.' };
    }
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
    return { error: `You need ${formatCurrencyAmount(guild.id, item.cost, { lowercase: true })} to buy ${item.label}. Balance: ${formatCurrencyAmount(guild.id, balance, { lowercase: true })}.` };
  }

  const reason = `${item.label} purchased by ${actor.tag} (${actor.id})`;

  try {
    await targetMember.timeout(TIMEOUT_DURATION_MS, reason);
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, item.cost);
    return { error: `Failed to apply the timeout. Your ${formatCurrencyWord(guild.id, 2, { lowercase: true })} were refunded.` };
  }

  await immunityStore.recordSilence(guild.id, targetMember.id, TIMEOUT_DURATION_MS, IMMUNITY_BUFFER_MS);

  const newBalance = rupeeStore.getBalance(guild.id, actor.id);
  return { success: true, newBalance };
}

async function applyMuzzlePurchase({ interaction, item, targetMember, modRoleId }) {
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
  if (hasModeratorRole(targetMember, modRoleId)) {
    return { error: 'Muzzle cannot be used on moderators.' };
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
    return { error: `You need ${formatCurrencyAmount(guild.id, item.cost, { lowercase: true })} to buy ${item.label}. Balance: ${formatCurrencyAmount(guild.id, balance, { lowercase: true })}.` };
  }

  const reason = `Muzzle purchased by ${actor.tag} (${actor.id})`;
  try {
    await targetMember.voice.setMute(true, reason);
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, item.cost);
    return { error: `Failed to apply the muzzle. Your ${formatCurrencyWord(guild.id, 2, { lowercase: true })} were refunded.` };
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
    return { error: `You need ${formatCurrencyAmount(guild.id, cost, { lowercase: true })} for Nickname Change. Balance: ${formatCurrencyAmount(guild.id, balance, { lowercase: true })}.` };
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

async function applyMemberNicknamePurchase({ interaction, targetMember, newNickname, cost, modRoleId }) {
  const guild = interaction.guild;
  const actor = interaction.user;
  const me = guild.members.me;

  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageNicknames)) {
    return { error: 'I need the Manage Nicknames permission to rename members.' };
  }

  if (!targetMember) {
    return { error: 'Could not resolve that member.' };
  }

  if (targetMember.user.bot) {
    return { error: 'Bots cannot be nicknamed with this item.' };
  }

  if (actor.id === targetMember.id) {
    return { error: 'Pick someone else to rename using this item.' };
  }

  if (isStaffMember(targetMember, modRoleId)) {
    return { error: 'Nickname Another Member can only target non-staff users.' };
  }

  if (!targetMember.manageable || me.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
    return { error: 'I cannot change that member due to role hierarchy. Move my role above them and try again.' };
  }

  const paid = await rupeeStore.spendTokens(guild.id, actor.id, cost);
  if (!paid) {
    const balance = rupeeStore.getBalance(guild.id, actor.id);
    return { error: `You need ${formatCurrencyAmount(guild.id, cost, { lowercase: true })} to rename a member. Balance: ${formatCurrencyAmount(guild.id, balance, { lowercase: true })}.` };
  }

  const reason = `Nickname a Member purchased by ${actor.tag} (${actor.id}) for ${targetMember.id}`;
  try {
    await targetMember.setNickname(newNickname, reason);
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
    return { error: `You need ${formatCurrencyAmount(guild.id, cost, { lowercase: true })} for this custom role. Balance: ${formatCurrencyAmount(guild.id, balance, { lowercase: true })}.` };
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

async function applyEveryonePingPurchase({ interaction, item, message }) {
  const guild = interaction.guild;
  const actor = interaction.user;
  const announceConfig = await getConfiguredAnnouncementChannel(guild, { requireMentionEveryone: true });
  if (announceConfig.error) {
    return { error: announceConfig.error };
  }
  const { announceChannel, announceChannelId } = announceConfig;

  const content = `@everyone ${message}`.trim();
  if (content.length > 2000) {
    return { error: 'Your message is too long. Keep it under 1990 characters.' };
  }

  const paid = await rupeeStore.spendTokens(guild.id, actor.id, item.cost);
  if (!paid) {
    const balance = rupeeStore.getBalance(guild.id, actor.id);
    return { error: `You need ${formatCurrencyAmount(guild.id, item.cost, { lowercase: true })} to buy ${item.label}. Balance: ${formatCurrencyAmount(guild.id, balance, { lowercase: true })}.` };
  }

  try {
    await announceChannel.send({
      content,
      allowedMentions: { parse: ['everyone'] },
    });
  } catch (err) {
    await rupeeStore.addTokens(guild.id, actor.id, item.cost);
    return { error: `Failed to post in the announcement channel. Your ${formatCurrencyWord(guild.id, 2, { lowercase: true })} were refunded.` };
  }

  const newBalance = rupeeStore.getBalance(guild.id, actor.id);
  return { success: true, newBalance, announceChannelId, announceChannel };
}

async function getConfiguredAnnouncementChannel(guild, { requireMentionEveryone = false } = {}) {
  const announceChannelId = smiteConfigStore.getAnnounceChannelId(guild.id);
  if (!announceChannelId) {
    return { error: 'No announcement channel is configured. Set it first in `/economyconfig`.' };
  }

  const announceChannel = await guild.channels.fetch(announceChannelId).catch(() => null);
  if (!announceChannel || !announceChannel.isTextBased?.() || announceChannel.type === ChannelType.GuildForum) {
    return { error: 'The configured announcement channel is invalid. Update it in `/economyconfig`.' };
  }

  const me = guild.members.me;
  const channelPerms = announceChannel.permissionsFor(me);
  if (!channelPerms?.has(PermissionsBitField.Flags.SendMessages)) {
    return { error: `I cannot send messages in <#${announceChannelId}>.` };
  }
  if (requireMentionEveryone && !channelPerms?.has(PermissionsBitField.Flags.MentionEveryone)) {
    return { error: `I need the Mention Everyone permission in <#${announceChannelId}> to use this item.` };
  }

  return { announceChannel, announceChannelId };
}

function buildTargetedStoreAnnouncementEmbed({
  guildId,
  item,
  actor,
  targetLabel,
  targetAvatarUrl,
  durationMs = null,
  everyoneMessage = '',
}) {
  const embed = makeEmbed(guildId).setTitle(item.label);

  if (item.id === 'everyone_ping') {
    embed.setDescription(`${actor} has deployed a **${item.label}** on ${targetLabel}.`);
    const cleanMessage = truncateForEmbed(everyoneMessage, 1024);
    if (cleanMessage) {
      embed.addFields({ name: 'Message', value: cleanMessage, inline: false });
    }
  } else if (item.id === 'muzzle') {
    embed.setDescription(`${actor} has deployed a **${item.label}** on ${targetLabel} and has server-muted them for ${formatMinutes(durationMs || MUZZLE_DURATION_MS)}.`);
  } else {
    embed.setDescription(`${actor} has deployed a **${item.label}** on ${targetLabel} and has muted them for ${formatMinutes(durationMs || TIMEOUT_DURATION_MS)}.`);
  }

  if (targetAvatarUrl) {
    embed.setThumbnail(targetAvatarUrl);
  }

  embed
    .setFooter({
      text: `Used by ${actor.tag}`,
      iconURL: actor.displayAvatarURL({ size: 256 }),
    })
    .setTimestamp(new Date());

  return embed;
}

async function sendStoreTargetAnnouncement({
  interaction,
  item,
  targetMember = null,
  durationMs = null,
  everyoneMessage = '',
  announceChannel = null,
}) {
  try {
    let channel = announceChannel;
    if (!channel) {
      const resolved = await getConfiguredAnnouncementChannel(interaction.guild, { requireMentionEveryone: false });
      if (resolved.error) return;
      channel = resolved.announceChannel;
    }
    if (!channel) return;

    const targetLabel = targetMember ? `${targetMember}` : '@everyone';
    const targetAvatarUrl = targetMember
      ? targetMember.displayAvatarURL({ size: 256 })
      : interaction.guild?.iconURL({ size: 256 }) || interaction.user.displayAvatarURL({ size: 256 });

    const embed = buildTargetedStoreAnnouncementEmbed({
      guildId: interaction.guildId,
      item,
      actor: interaction.user,
      targetLabel,
      targetAvatarUrl,
      durationMs,
      everyoneMessage,
    });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    cmdLogger.error('Failed to send store purchase announcement:', err?.message || err);
  }
}

async function getModerators(guild, modRoleId) {
  if (!guild || !modRoleId) return [];
  try {
    let role = guild.roles.cache.get(modRoleId);
    if (!role) {
      role = await guild.roles.fetch(modRoleId).catch(() => null);
    }
    if (!role) return [];
    await guild.members.fetch().catch(() => null);
    return role.members.filter(member => !member.user.bot).toJSON();
  } catch (_) {
    return [];
  }
}

async function handleStorePurchaseResult(interaction, item, targetMember, result) {
  if (result.blockedMs) {
    await interaction.reply({
      embeds: [makeEmbed(interaction.guildId).setTitle('Target is immune').setDescription(`${targetMember} cannot be targeted for ${formatMinutes(result.blockedMs)}.`)],
      ephemeral: true,
    });
    return true;
  }
  if (result.error) {
    logStorePurchaseError(interaction, result.error, { itemId: item?.id || null, targetId: targetMember?.id || null });
    await interaction.reply({ embeds: [makeEmbed(interaction.guildId).setTitle('Purchase failed').setDescription(result.error)], ephemeral: true });
    return true;
  }
  const durationMs = item.kind === 'muzzle' ? MUZZLE_DURATION_MS : TIMEOUT_DURATION_MS;
  await interaction.reply({
    embeds: [makeEmbed(interaction.guildId).setTitle(`${item.label} applied`).setDescription(`${item.label} used on ${targetMember} for ${formatMinutes(durationMs)}.\nRemaining balance: ${formatCurrencyAmount(interaction.guildId, result.newBalance, { lowercase: true })}.`)],
    ephemeral: true,
  });
  await logRupeeStorePurchase({
    interaction,
    itemLabel: item.label,
    cost: item.cost,
    target: targetMember,
    balance: Number.isFinite(result.newBalance) ? result.newBalance : rupeeStore.getBalance(interaction.guildId, interaction.user.id),
  });
  await sendStoreTargetAnnouncement({
    interaction,
    item,
    targetMember,
    durationMs,
  });
  return true;
}

function buildStoreItemEmbed(guildId, item) {
  return makeEmbed(guildId)
    .setTitle(item.label)
    .setDescription(`${item.description}\n\nCost: ${formatCurrencyAmount(guildId, item.cost, { lowercase: true })}`);
}

function buildStoreItemPayload(guildId, item) {
  if (!item) return null;
  switch (item.id) {
    case 'stfu':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [buildUserSelect('store:buy:stfu', false, 'Select a non-admin/non-mod user')],
      };
    case 'muzzle':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [buildUserSelect('store:buy:muzzle', false, 'Select a non-admin/non-mod user in voice')],
      };
    case 'abuse_mod':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [],
      };
    case 'nickname':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store:openmodal:nickname').setLabel('Change Nickname').setStyle(ButtonStyle.Primary))],
      };
    case 'nickname_member':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [buildUserSelect('store:buy:nickname_member', false, 'Select a non-staff user')],
      };
    case 'custom_role_solid':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store:openmodal:custom_role_solid').setLabel('Configure Solid Role').setStyle(ButtonStyle.Primary))],
      };
    case 'custom_role_gradient':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store:openmodal:custom_role_gradient').setLabel('Configure Gradient Role').setStyle(ButtonStyle.Primary))],
      };
    case 'everyone_ping':
      return {
        itemId: item.id,
        embeds: [buildStoreItemEmbed(guildId, item)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('store:openmodal:everyone_ping').setLabel('Create Message').setStyle(ButtonStyle.Primary))],
      };
    default:
      return null;
  }
}

function buildStoreItemMessages(guildId, shopItems) {
  if (!Array.isArray(shopItems) || shopItems.length === 0) return [];
  return shopItems.map(item => buildStoreItemPayload(guildId, item)).filter(Boolean);
}

async function buildAbuseModMenu(guild, modRoleId) {
  if (!modRoleId) {
    return buildModeratorSelect('store:buy:abuse_mod', [], true);
  }
  const moderators = await getModerators(guild, modRoleId);
  return buildModeratorSelect('store:buy:abuse_mod', moderators, false);
}

async function handleStoreButton(interaction) {
  if (!interaction.customId.startsWith('store:openmodal:')) return false;
  const itemId = interaction.customId.slice('store:openmodal:'.length);
  const item = findItem(itemId, resolveShopItemsForGuild(interaction.guildId));
  if (!item) {
    await interaction.reply({ content: 'This item is unavailable.', ephemeral: true });
    return true;
  }

  if (item.id === 'nickname') {
    const modal = new ModalBuilder()
      .setCustomId('store:modal:nickname')
      .setTitle('Nickname')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nickname').setLabel('New nickname').setStyle(TextInputStyle.Short).setMaxLength(32).setMinLength(1).setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (item.id === 'everyone_ping') {
    const modal = new ModalBuilder()
      .setCustomId('store:modal:everyone_ping')
      .setTitle('Guilt Free @everyone')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('everyone_message')
            .setLabel('Message for @everyone')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(1900),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (item.kind === 'custom_role') {
    const modal = new ModalBuilder()
      .setCustomId(`store:modal:${item.id}`)
      .setTitle(item.label.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('role_name').setLabel('Role name (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('color_primary').setLabel(item.mode === 'gradient' ? 'Primary colour (#RRGGBB)' : 'Colour (#RRGGBB)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder('#FF00AA'),
        ),
        ...(item.mode === 'gradient'
          ? [new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color_secondary').setLabel('Secondary colour (#RRGGBB)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder('#00FFC8'))]
          : []),
      );
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

async function handleStoreUserSelect(interaction) {
  if (!interaction.customId.startsWith('store:buy:')) return false;
  const itemId = interaction.customId.slice('store:buy:'.length);
  if (itemId === 'abuse_mod') return false;
  const item = findItem(itemId, resolveShopItemsForGuild(interaction.guildId));
  if (!item) {
    logStorePurchaseError(interaction, 'Requested store item is unavailable.', { itemId });
    await interaction.reply({ content: 'This item is unavailable.', ephemeral: true });
    return true;
  }
  const targetId = interaction.values?.[0];
  const targetMember = targetId ? await interaction.guild.members.fetch(targetId).catch(() => null) : null;
  if (!targetMember) {
    logStorePurchaseError(interaction, 'Invalid target member for store purchase.', { itemId, targetId: targetId || null });
    await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
    return true;
  }
  const modRoleId = await getModeratorRoleId(interaction.guildId);

  if (item.kind === 'timeout' || item.kind === 'muzzle') {
    const applyFn = item.kind === 'timeout' ? applyTimeoutPurchase : applyMuzzlePurchase;
    const result = await applyFn({ interaction, item, targetMember, modRoleId });
    return handleStorePurchaseResult(interaction, item, targetMember, result);
  }

  if (item.id === 'nickname_member') {
    if (isStaffMember(targetMember, modRoleId)) {
      logStorePurchaseError(interaction, 'Invalid target for Nickname Another Member: staff users are not allowed.', { itemId, targetId: targetMember.id });
      await interaction.reply({ content: 'Nickname Another Member can only target non-staff users.', ephemeral: true });
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(`store:modal:nickname_member:${targetMember.id}`)
      .setTitle('Nickname Another Member')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nickname').setLabel(`New nickname for ${targetMember.displayName || targetMember.user.username}`.slice(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(32).setMinLength(1).setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

async function handleStoreStringSelect(interaction) {
  if (interaction.customId !== 'store:buy:abuse_mod') return false;
  const targetId = interaction.values?.[0];
  if (!targetId || targetId === 'none') {
    logStorePurchaseError(interaction, 'Invalid target for Abuse Mod: no moderator target selected.', { itemId: 'abuse_mod', targetId: targetId || null });
    await interaction.reply({ content: 'No moderator is available to target right now.', ephemeral: true });
    return true;
  }
  const item = findItem('abuse_mod', resolveShopItemsForGuild(interaction.guildId));
  const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!item || !targetMember) {
    logStorePurchaseError(interaction, 'Invalid target for Abuse Mod: moderator target is unavailable.', { itemId: 'abuse_mod', targetId });
    await interaction.reply({ content: 'That moderator target is unavailable.', ephemeral: true });
    return true;
  }
  const modRoleId = await getModeratorRoleId(interaction.guildId);
  const result = await applyTimeoutPurchase({ interaction, item, targetMember, modRoleId });
  return handleStorePurchaseResult(interaction, item, targetMember, result);
}
async function handleStoreModalSubmit(interaction) {
  if (!interaction.customId.startsWith('store:modal:')) return false;
  const shopItems = resolveShopItemsForGuild(interaction.guildId);

  if (interaction.customId === 'store:modal:nickname') {
    const item = findItem('nickname', shopItems);
    const nicknameRaw = interaction.fields.getTextInputValue('nickname') || '';
    const nickname = nicknameRaw.trim().slice(0, 32);
    if (!nickname) {
      await interaction.reply({ content: 'Please enter a valid nickname.', ephemeral: true });
      return true;
    }
    const result = await applyNicknamePurchase({ interaction, newNickname: nickname, cost: item.cost });
    if (result.error) {
      logStorePurchaseError(interaction, result.error, { itemId: 'nickname', targetId: interaction.user.id });
      await interaction.reply({ content: result.error, ephemeral: true });
      return true;
    }
    await interaction.reply({ embeds: [makeEmbed(interaction.guildId).setTitle('Nickname updated').setDescription(`Your nickname is now **${escapeMarkdown(nickname)}**.\nRemaining balance: ${formatCurrencyAmount(interaction.guildId, result.newBalance, { lowercase: true })}.`)], ephemeral: true });
    await logRupeeStorePurchase({ interaction, itemLabel: item.label, cost: item.cost, target: interaction.user, balance: result.newBalance });
    return true;
  }

  if (interaction.customId.startsWith('store:modal:nickname_member:')) {
    const targetId = interaction.customId.slice('store:modal:nickname_member:'.length);
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    const item = findItem('nickname_member', shopItems);
    if (!targetMember || !item) {
      logStorePurchaseError(interaction, 'Invalid target for Nickname Another Member: target is missing or item unavailable.', { itemId: 'nickname_member', targetId: targetId || null });
      await interaction.reply({ content: 'Could not find that target member.', ephemeral: true });
      return true;
    }
    const nicknameRaw = interaction.fields.getTextInputValue('nickname') || '';
    const nickname = nicknameRaw.trim().slice(0, 32);
    if (!nickname) {
      await interaction.reply({ content: 'Please enter a valid nickname.', ephemeral: true });
      return true;
    }
    const modRoleId = await getModeratorRoleId(interaction.guildId);
    const result = await applyMemberNicknamePurchase({ interaction, targetMember, newNickname: nickname, cost: item.cost, modRoleId });
    if (result.error) {
      logStorePurchaseError(interaction, result.error, { itemId: 'nickname_member', targetId: targetMember.id });
      await interaction.reply({ content: result.error, ephemeral: true });
      return true;
    }
    await interaction.reply({ embeds: [makeEmbed(interaction.guildId).setTitle('Nickname updated').setDescription(`${targetMember} renamed to **${escapeMarkdown(nickname)}**.\nRemaining balance: ${formatCurrencyAmount(interaction.guildId, result.newBalance, { lowercase: true })}.`)], ephemeral: true });
    await logRupeeStorePurchase({ interaction, itemLabel: item.label, cost: item.cost, target: targetMember, balance: result.newBalance });
    return true;
  }

  if (interaction.customId === 'store:modal:everyone_ping') {
    const item = findItem('everyone_ping', shopItems);
    if (!item) {
      logStorePurchaseError(interaction, 'Requested @everyone item is unavailable.', { itemId: 'everyone_ping' });
      await interaction.reply({ content: 'This item is unavailable.', ephemeral: true });
      return true;
    }

    const messageRaw = interaction.fields.getTextInputValue('everyone_message') || '';
    const message = messageRaw.trim();
    if (!message) {
      await interaction.reply({ content: 'Please enter a message to send.', ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await applyEveryonePingPurchase({ interaction, item, message });
    if (result.error) {
      logStorePurchaseError(interaction, result.error, { itemId: item.id, targetId: 'everyone' });
      await interaction.editReply({ content: result.error });
      return true;
    }

    await interaction.editReply({
      embeds: [
        makeEmbed(interaction.guildId)
          .setTitle('Message sent')
          .setDescription(`Your @everyone announcement was posted in <#${result.announceChannelId}>.\nRemaining balance: ${formatCurrencyAmount(interaction.guildId, result.newBalance, { lowercase: true })}.`),
      ],
    });
    await logRupeeStorePurchase({
      interaction,
      itemLabel: item.label,
      cost: item.cost,
      target: 'Announcement Channel',
      balance: result.newBalance,
    });
    await sendStoreTargetAnnouncement({
      interaction,
      item,
      everyoneMessage: message,
      announceChannel: result.announceChannel,
    });
    return true;
  }

  if (interaction.customId === 'store:modal:custom_role_solid' || interaction.customId === 'store:modal:custom_role_gradient') {
    const itemId = interaction.customId.replace('store:modal:', '');
    const item = findItem(itemId, shopItems);
    if (!item) {
      logStorePurchaseError(interaction, 'Requested custom role item is unavailable.', { itemId });
      await interaction.reply({ content: 'This item is unavailable.', ephemeral: true });
      return true;
    }
    const nameInput = interaction.fields.getTextInputValue('role_name') || '';
    const primaryRaw = interaction.fields.getTextInputValue('color_primary') || '';
    const secondaryRaw = item.mode === 'gradient' ? interaction.fields.getTextInputValue('color_secondary') || '' : null;
    const primary = normalizeHex6(primaryRaw);
    const secondary = item.mode === 'gradient' ? normalizeHex6(secondaryRaw) : null;
    if (!primary || (item.mode === 'gradient' && !secondary)) {
      await interaction.reply({ content: 'Please provide valid hex colours like #A1B2C3.', ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await applyCustomRolePurchase({
      interaction,
      mode: item.mode,
      colors: item.mode === 'gradient' ? [primary, secondary] : [primary],
      roleName: nameInput,
      cost: item.cost,
    });
    if (result.error) {
      logStorePurchaseError(interaction, result.error, { itemId: item.id, targetId: interaction.user.id });
      await interaction.editReply({ content: result.error });
      return true;
    }
    await interaction.editReply({ content: `✅ ${item.label} applied.\nRemaining balance: ${formatCurrencyAmount(interaction.guildId, result.newBalance, { lowercase: true })}.` });
    await logRupeeStorePurchase({ interaction, itemLabel: item.label, cost: item.cost, target: interaction.user, balance: result.newBalance });
    return true;
  }

  return false;
}

function withStoreItemChoices(optionBuilder) {
  const choices = SHOP_ITEMS.map((item, index) => ({
    name: `${index + 1}. ${item.label}`.slice(0, 100),
    value: item.id,
  }));
  optionBuilder.addChoices(...choices);
  return optionBuilder;
}

module.exports = {
  SHOP_ITEMS,
  handleStoreButton,
  handleStoreUserSelect,
  handleStoreStringSelect,
  handleStoreModalSubmit,
  data: new SlashCommandBuilder()
    .setName('storeconfig')
    .setDescription('Manage which store items are available and post item panels')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add an item back into the store and post its panel')
        .addStringOption(option => withStoreItemChoices(
          option
            .setName('item')
            .setDescription('Store item to add')
            .setRequired(true),
        )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove an item from the store')
        .addStringOption(option => withStoreItemChoices(
          option
            .setName('item')
            .setDescription('Store item to remove')
            .setRequired(true),
        )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('post')
        .setDescription('Post all currently enabled store item panels')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const isAdmin = interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator);
    const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
    if (!isAdmin && !isGuildOwner) {
      await interaction.reply({ content: 'Administrator permission is required to use this command.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    const config = smiteConfigStore.getConfig(interaction.guildId);

    if (subcommand === 'remove') {
      const itemId = interaction.options.getString('item', true);
      const wasEnabled = Array.isArray(config.storeItemIds) && config.storeItemIds.includes(itemId);
      const item = SHOP_ITEMS.find(entry => entry.id === itemId);
      await smiteConfigStore.removeStoreItem(interaction.guildId, itemId);

      if (!wasEnabled) {
        await interaction.reply({
          content: `${item?.label || itemId} is already removed from the store.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `${item?.label || itemId} removed from the store. Existing panel messages for this item will no longer work.`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'add') {
      const itemId = interaction.options.getString('item', true);
      const alreadyEnabled = Array.isArray(config.storeItemIds) && config.storeItemIds.includes(itemId);
      await smiteConfigStore.addStoreItem(interaction.guildId, itemId);

      const item = findItem(itemId, resolveShopItemsForGuild(interaction.guildId)) || SHOP_ITEMS.find(entry => entry.id === itemId);
      if (!item) {
        await interaction.reply({ content: 'Failed to load that item after updating the store config.', ephemeral: true });
        return;
      }

      const channelId = config.storePanelChannelId;
      if (!channelId) {
        await interaction.reply({
          content: `${item.label} is now enabled in the store. No store panel channel is configured yet, so no panel was posted.`,
          ephemeral: true,
        });
        return;
      }

      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased?.() || channel.type === ChannelType.GuildForum) {
        await interaction.reply({
          content: `${item.label} is now enabled in the store, but the configured store panel channel is invalid. Update it in \`/economyconfig\`.`,
          ephemeral: true,
        });
        return;
      }

      const me = interaction.guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
        await interaction.reply({
          content: `${item.label} is now enabled in the store, but I cannot send messages in ${channel}.`,
          ephemeral: true,
        });
        return;
      }

      const payload = buildStoreItemPayload(interaction.guildId, item);
      if (!payload) {
        await interaction.reply({ content: 'This store item cannot be posted yet.', ephemeral: true });
        return;
      }

      if (payload.itemId === 'abuse_mod') {
        const modRoleId = await getModeratorRoleId(interaction.guildId);
        payload.components = [await buildAbuseModMenu(interaction.guild, modRoleId)];
      }

      await channel.send({
        embeds: payload.embeds,
        components: payload.components,
      });

      await interaction.reply({
        content: `${item.label} ${alreadyEnabled ? 'is already enabled, so I reposted' : 'was added and posted'} in ${channel}.`,
        ephemeral: true,
      });
      return;
    }

    const channelId = config.storePanelChannelId;
    if (!channelId) {
      await interaction.reply({ content: 'No store panel channel is configured. Set it first in `/economyconfig`.', ephemeral: true });
      return;
    }

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.() || channel.type === ChannelType.GuildForum) {
      await interaction.reply({ content: 'The configured store panel channel is invalid. Update it in `/economyconfig`.', ephemeral: true });
      return;
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
      await interaction.reply({ content: `I cannot send messages in ${channel}.`, ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const shopItems = resolveShopItemsForGuild(interaction.guildId);
    if (!shopItems.length) {
      await interaction.editReply({ content: 'No store items are enabled. Use `/storeconfig add` first.' });
      return;
    }

    const payloads = buildStoreItemMessages(interaction.guildId, shopItems);
    const modRoleId = await getModeratorRoleId(interaction.guildId);
    let sent = 0;
    for (const payload of payloads) {
      const components = payload.itemId === 'abuse_mod'
        ? [await buildAbuseModMenu(interaction.guild, modRoleId)]
        : payload.components;
      // eslint-disable-next-line no-await-in-loop
      await channel.send({
        embeds: payload.embeds,
        components,
      });
      sent += 1;
    }
    await interaction.editReply({ content: `Posted ${sent} enabled store item panel messages in ${channel}.` });
  },
};

