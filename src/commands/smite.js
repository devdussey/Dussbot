const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, StickerFormatType } = require('discord.js');
const tokenStore = require('../utils/messageTokenStore');
const coinStore = require('../utils/coinStore');
const smiteConfigStore = require('../utils/smiteConfigStore');
const securityLogger = require('../utils/securityLogger');
const modLogger = require('../utils/modLogger');
const { getSmiteCost } = require('../utils/economyConfig');

const BAG_LABEL = 'Smite';
const DEFAULT_SMITE_IMAGE_URL = process.env.SMITE_IMAGE_URL || process.env.SMITE_DEFAULT_IMAGE_URL || null;
const MAX_MINUTES = 5;

function formatCoins(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMinutes(value) {
  const minutes = Number(value);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : MAX_MINUTES;
  return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stfu')
    .setDescription('Spend a Smite to silence a user for up to 5 minutes')
    .addUserOption(opt =>
      opt
        .setName('target')
        .setDescription('Member to timeout')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('duration')
        .setDescription('Timeout duration in minutes (1-5). Defaults to 5 minutes.')
        .setMinValue(1)
        .setMaxValue(MAX_MINUTES)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Reason for spending the Smite (optional, max 200 characters).')
        .setMaxLength(200)
    )
    .addStringOption(opt =>
      opt
        .setName('sticker')
        .setDescription('Sticker name or ID from this server to display on the Smite embed')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const smiteConfig = smiteConfigStore.getConfig(interaction.guildId);
    if (!smiteConfig.enabled) {
      return interaction.reply({ content: 'Smite is disabled on this server.', ephemeral: true });
    }
    const immuneRoleIds = new Set(smiteConfig.immuneRoleIds || []);

    await interaction.deferReply({ ephemeral: true });

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      await securityLogger.logPermissionDenied(interaction, 'stfu', 'Bot missing Moderate Members');
      return interaction.editReply({ content: 'I need the Moderate Members permission to spend Smites.' });
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    let smiteBalance = tokenStore.getBalance(guildId, userId);
    const smiteCost = getSmiteCost();
    let coinsSpent = false;

    if (smiteBalance <= 0 && smiteCost > 0) {
      const coinsAvailable = coinStore.getBalance(guildId, userId);
      if (coinsAvailable + 1e-6 >= smiteCost) {
        const spent = await coinStore.spendCoins(guildId, userId, smiteCost);
        if (spent) {
          await tokenStore.addTokens(guildId, userId, 1);
          smiteBalance = tokenStore.getBalance(guildId, userId);
          coinsSpent = true;
        }
      }
    }

    if (smiteBalance <= 0) {
      const coinsAvailable = coinStore.getBalance(guildId, userId);
      const costText = smiteCost > 0
        ? `${formatCoins(smiteCost)} coin${smiteCost === 1 ? '' : 's'}`
        : 'coins';
      const balanceText = `${formatCoins(coinsAvailable)} coin${coinsAvailable === 1 ? '' : 's'}`;
      return interaction.editReply({
        content: `You do not have any ${BAG_LABEL}s. You need ${costText} to buy one. Current balance: ${balanceText}.`,
      });
    }

    const targetUser = interaction.options.getUser('target', true);
    if (targetUser.id === interaction.user.id) {
      return interaction.editReply({ content: "You can't use a Smite on yourself." });
    }
    if (targetUser.id === interaction.client.user.id) {
      return interaction.editReply({ content: "You can't spend a Smite on me." });
    }
    if (targetUser.bot) {
      return interaction.editReply({ content: "You can't use a Smite on a bot." });
    }

    let targetMember;
    try {
      targetMember = await interaction.guild.members.fetch(targetUser.id);
    } catch (_) {
      return interaction.editReply({ content: 'That user is not in this server.' });
    }

    const immuneRoles = targetMember.roles.cache.filter(role => immuneRoleIds.has(role.id));
    if (immuneRoles.size > 0) {
      const immuneList = immuneRoles.map(role => role.toString()).join(', ');
      await securityLogger.logPermissionDenied(interaction, 'stfu', 'Target has Smite immune role', [
        { name: 'Target', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
        { name: 'Immune Roles', value: immuneList, inline: false },
      ]);
      return interaction.editReply({ content: `You cannot spend Smites on members with immune roles. Roles: ${immuneList}` });
    }

    const meHigher = me.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
    if (!meHigher || !targetMember.moderatable) {
      await securityLogger.logHierarchyViolation(interaction, 'stfu', targetMember, 'Bot lower than target or not moderatable');
      return interaction.editReply({ content: "I can't timeout that member due to role hierarchy or permissions." });
    }

    const durationInput = interaction.options.getInteger('duration');
    let durationMinutes = durationInput ?? MAX_MINUTES;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) durationMinutes = MAX_MINUTES;
    if (durationMinutes > MAX_MINUTES) durationMinutes = MAX_MINUTES;
    const durationMs = durationMinutes * 60_000;

    const reasonRaw = (interaction.options.getString('reason') || '').trim();
    const reason = reasonRaw.slice(0, 200);
    const stickerInput = (interaction.options.getString('sticker') || '').trim();

    const consumed = await tokenStore.consumeToken(guildId, userId);
    if (!consumed) {
      if (coinsSpent && smiteCost > 0) {
        await coinStore.addCoins(guildId, userId, smiteCost);
      }
      return interaction.editReply({ content: `You no longer have a ${BAG_LABEL} to spend.` });
    }

    try {
      const auditReasonParts = [`${BAG_LABEL} used by ${interaction.user.tag} (${interaction.user.id})`];
      if (reason) auditReasonParts.push(`Reason: ${reason}`);
      const auditReason = auditReasonParts.join(' | ').slice(0, 512);
      await targetMember.timeout(durationMs, auditReason);

      const remainingBags = tokenStore.getBalance(guildId, userId);
      const humanReason = reason || 'No reason provided';
      const baseMessage = `Timed out ${targetUser.tag} for ${durationMinutes} minute${durationMinutes === 1 ? '' : 's'} using a ${BAG_LABEL}.`;
      const parts = [
        baseMessage,
        `Remaining Smites: ${remainingBags}.`,
        `Reason: ${humanReason}.`,
      ];
      if (coinsSpent && smiteCost > 0) {
        parts.push(`Coins spent: ${formatCoins(smiteCost)}.`);
      }
      await interaction.editReply({ content: parts.join(' ') });

      try {
        let stickerUrl = null;
        if (stickerInput && interaction.guild) {
          const stickers = interaction.guild.stickers?.cache?.size
            ? interaction.guild.stickers.cache
            : await interaction.guild.stickers.fetch().catch(() => null);
          const sticker = stickers
            ? stickers.find(s =>
              s.id === stickerInput ||
              s.name.toLowerCase() === stickerInput.toLowerCase()
            )
            : null;
          if (sticker && sticker.format !== StickerFormatType.Lottie) {
            stickerUrl = sticker.url;
          }
        }

        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription(
            `${interaction.user.username} is tired of ${targetUser.username} bullshit for ${formatMinutes(durationMinutes)}\nReason: ${humanReason}`
          )
          .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
          .setFooter({
            text: `Performed by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
          });
        const imageUrl = stickerUrl || DEFAULT_SMITE_IMAGE_URL;
        if (imageUrl) embed.setImage(imageUrl);
        await interaction.channel?.send({ embeds: [embed] });
      } catch (_) {}

      try {
        const extraFields = [
          { name: 'Duration', value: `${durationMinutes} minute${durationMinutes === 1 ? '' : 's'}`, inline: true },
          { name: 'Remaining Smites', value: String(remainingBags), inline: true },
        ];
        if (coinsSpent && smiteCost > 0) {
          extraFields.push({ name: 'Coins Spent', value: `${formatCoins(smiteCost)} coin${smiteCost === 1 ? '' : 's'}`, inline: true });
        }
        await modLogger.log(interaction, 'Smite Timeout', {
          target: targetUser,
          thumbnailTarget: targetUser,
          reason: humanReason,
          color: 0x2ecc71,
          extraFields,
        });
      } catch (_) {}
    } catch (err) {
      await tokenStore.addTokens(guildId, userId, 1);
      if (coinsSpent && smiteCost > 0) {
        await coinStore.addCoins(guildId, userId, smiteCost);
      }
      const errorMsg = err?.message ? `Failed to timeout the member: ${err.message}` : 'Failed to timeout the member.';
      await interaction.editReply({ content: `${errorMsg} Your ${BAG_LABEL} was refunded.` });
    }
  },
};
