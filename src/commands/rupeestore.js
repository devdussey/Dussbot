const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionsBitField,
  ComponentType,
} = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const coinStore = require('../utils/coinStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const immunityStore = require('../utils/silenceImmunityStore');

const SHOP_ITEMS = [
  {
    id: 'stfu',
    label: 'STFU',
    cost: 5,
    description: 'Silence any user for 5 minutes.',
    requireModeratorTarget: false,
    moderatorOnly: false,
  },
  {
    id: 'abuse_mod',
    label: 'Abuse Mod',
    cost: 10,
    description: 'Silence a moderator for 5 minutes.',
    requireModeratorTarget: true,
    moderatorOnly: true,
  },
];

const TIMEOUT_DURATION_MS = 5 * 60_000;
const IMMUNITY_BUFFER_MS = 10 * 60_000; // After timeout ends

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

function buildShopEmbed({ guildId, balance, selectedItemId = null, blessingStatus }) {
  const embed = makeEmbed(guildId)
    .setTitle('🏪 Rupee Store')
    .setDescription(
      'Spend your rupees on limited-time moderation toys. Choose an item, then pick a target to apply it to.\n' +
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

  embed.setFooter({ text: 'STFU and Abuse Mod targets gain 10 minutes of immunity after their timeout ends.' });

  return embed;
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
        const freshBalance = rupeeStore.getBalance(guildId, interaction.user.id);
        const freshBlessing = formatBlessingStatus(guildId, userId);
        const updatedEmbed = buildShopEmbed({
          guildId,
          balance: freshBalance,
          selectedItemId: itemId,
          blessingStatus: freshBlessing,
        });
        const freshItemRow = buildItemSelect(selectId, false);

        if (selectedItem?.moderatorOnly) {
          const moderators = await getModerators(interaction.guild);
          const modRow = buildModeratorSelect(`${targetSelectBase}:${itemId}`, moderators, false);
          await componentInteraction.update({
            embeds: [updatedEmbed],
            components: [freshItemRow, modRow],
          });
        } else {
          const enabledUserRow = buildUserSelect(`${targetSelectBase}:${itemId}`, false, `Pick a target for ${selectedItem?.label ?? 'this item'}`);
          await componentInteraction.update({
            embeds: [updatedEmbed],
            components: [freshItemRow, enabledUserRow],
          });
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

        const result = await applyTimeoutPurchase({
          interaction,
          item: selectedItem,
          targetMember,
        });

        if (result.blockedMs) {
          const embed = makeEmbed(guildId)
            .setTitle('Target is immune')
            .setDescription(
              `${targetMember.displayName || targetMember.user.username} can't be silenced for ${formatMinutes(result.blockedMs)}.`
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

        const successEmbed = makeEmbed(guildId)
          .setTitle(`${selectedItem.label} applied`)
          .setDescription(
            `${selectedItem.label} used on ${targetMember} for ${formatMinutes(TIMEOUT_DURATION_MS)}.\n` +
            `Remaining balance: ${result.newBalance} rupee${result.newBalance === 1 ? '' : 's'}.`
          );
        await componentInteraction.reply({ embeds: [successEmbed], ephemeral: true });

        const publicEmbed = makeEmbed(guildId)
          .setTitle(`${selectedItem.label} deployed`)
          .setDescription(
            `${interaction.user} used **${selectedItem.label}** on ${targetMember} for ${formatMinutes(TIMEOUT_DURATION_MS)}.`
          )
          .setThumbnail(targetMember.displayAvatarURL({ extension: 'png', size: 256 }))
          .setFooter({ text: 'Targets gain 10 minutes of immunity after their timeout ends.' });

        await interaction.channel?.send({
          embeds: [publicEmbed],
          allowedMentions: { users: [interaction.user.id, targetMember.id] },
        }).catch(() => {});

        const freshBalance = rupeeStore.getBalance(guildId, interaction.user.id);
        const freshBlessing = formatBlessingStatus(guildId, userId);
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
