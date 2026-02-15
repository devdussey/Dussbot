const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');
const smiteConfigStore = require('../utils/smiteConfigStore');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { SHOP_ITEMS } = require('./rupeestore');
const { getCurrencyName, formatCurrencyAmount, formatCurrencyWord } = require('../utils/currencyName');

const HORSE_RACE_WIN_RUPEES = 1;
const SESSION_TIMEOUT_MS = 10 * 60_000;
const STORE_ITEM_LOOKUP = new Map((SHOP_ITEMS || []).map(item => [String(item.id), item]));

function parseRoleId(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const mention = value.match(/^<@&(\d+)>$/);
  if (mention) return mention[1];
  const plain = value.match(/^\d{15,22}$/);
  return plain ? plain[0] : null;
}

function parseChannelId(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const mention = value.match(/^<#(\d+)>$/);
  if (mention) return mention[1];
  const plain = value.match(/^\d{15,22}$/);
  return plain ? plain[0] : null;
}

function parsePositiveInteger(raw, { min = 1, max = 100_000 } = {}) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const whole = Math.floor(num);
  if (whole < min || whole > max) return null;
  return whole;
}

function parseStoreItemId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (STORE_ITEM_LOOKUP.has(value)) return value;
  const index = Number.parseInt(value, 10);
  if (Number.isInteger(index) && index >= 1 && index <= SHOP_ITEMS.length) {
    return SHOP_ITEMS[index - 1].id;
  }
  return null;
}

async function resolveRupeeLogChannelId(guildId) {
  const economyEntry = await logChannelTypeStore.getEntry(guildId, 'economy');
  if (economyEntry?.channelId) return String(economyEntry.channelId);

  const keys = ['rupee_earned', 'rupee_spend', 'rupee_given'];
  const unique = new Set();
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    const entry = await logChannelTypeStore.getEntry(guildId, key);
    if (entry?.channelId) unique.add(String(entry.channelId));
  }
  return unique.size === 1 ? Array.from(unique)[0] : null;
}

function formatImmuneRoles(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return 'Not Configured';
  return roleIds.map(id => `<@&${id}>`).join(', ');
}

function formatStoreConfig(guildId, storeItemCosts) {
  const safeCosts = storeItemCosts && typeof storeItemCosts === 'object' ? storeItemCosts : {};
  if (!Array.isArray(SHOP_ITEMS) || SHOP_ITEMS.length === 0) return 'No store items found.';
  return SHOP_ITEMS.map((item, idx) => {
    const override = Number(safeCosts[item.id]);
    const hasOverride = Number.isFinite(override) && Math.floor(override) >= 1;
    const effectiveCost = hasOverride ? Math.floor(override) : item.cost;
    const suffix = hasOverride ? ' (custom)' : '';
    return `\`${idx + 1}.\` ${item.label} (\`${item.id}\`) = **${formatCurrencyAmount(guildId, effectiveCost, { lowercase: true })}**${suffix}`;
  }).join('\n');
}

function trimModalTitle(value) {
  const safe = String(value || '').trim() || 'Economy';
  return safe.slice(0, 45);
}

function buildEmbed(guild, config, rupeeLogChannelId) {
  const currencyName = getCurrencyName(guild?.id);
  const messageRate = Number(config.messageThreshold) || smiteConfigStore.DEFAULT_MESSAGE_THRESHOLD;
  const voiceRate = Number(config.voiceMinutesPerRupee) || smiteConfigStore.DEFAULT_VOICE_MINUTES_PER_RUPEE;
  const announceDisplay = config.announceChannelId ? `<#${config.announceChannelId}>` : 'Not Configured';
  const logDisplay = rupeeLogChannelId ? `<#${rupeeLogChannelId}>` : 'Not Configured';
  const enabledText = config.enabled ? 'Enabled' : 'Disabled';

  return new EmbedBuilder()
    .setTitle('Economy Configuration')
    .setDescription(`Current economy settings for **${guild?.name || 'this server'}**.`)
    .setColor(resolveEmbedColour(guild?.id, 0x00f0ff))
    .addFields(
      { name: 'Status', value: `**${enabledText}**`, inline: false },
      { name: 'Currency Name', value: `**${currencyName}**`, inline: false },
      {
        name: 'Earning Rates',
        value: [
          `**${messageRate}** messages = **${formatCurrencyAmount(guild?.id, 1)}**`,
          `**${voiceRate}** minute${voiceRate === 1 ? '' : 's'} in voice chat = **${formatCurrencyAmount(guild?.id, 1)}**`,
          `Horse Race Win = **${formatCurrencyAmount(guild?.id, HORSE_RACE_WIN_RUPEES)}**`,
        ].join('\n'),
        inline: false,
      },
      { name: 'Immunity Role', value: formatImmuneRoles(config.immuneRoleIds), inline: false },
      { name: `${currencyName} Announce Channel`, value: announceDisplay, inline: false },
      { name: `${currencyName} Log Channel`, value: logDisplay, inline: false },
      { name: 'Store Config', value: formatStoreConfig(guild?.id, config.storeItemCosts), inline: false },
    )
    .setFooter({ text: 'Use the buttons below to update this server only.' })
    .setTimestamp(new Date());
}

function buildButtons(baseId, enabled, disabled = false) {
  const toggleStyle = enabled ? ButtonStyle.Danger : ButtonStyle.Success;
  const toggleLabel = enabled ? 'Disable Economy Rewards' : 'Enable Economy Rewards';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${baseId}:toggle`)
        .setLabel(toggleLabel)
        .setStyle(toggleStyle)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${baseId}:rates`)
        .setLabel('Edit Message & VC Rates')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${baseId}:immunity`)
        .setLabel('Set Immunity Role')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${baseId}:announce`)
        .setLabel('Set Announce Channel')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${baseId}:log`)
        .setLabel('Set Log Channel')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${baseId}:currency`)
        .setLabel('Set Currency Name')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${baseId}:store`)
        .setLabel('Edit Store Prices')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    ),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economyconfig')
    .setDescription('Configure economy settings for this server')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addBooleanOption(opt =>
      opt
        .setName('enabled')
        .setDescription('Turn economy rewards on or off before opening the config view')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const canManageGuild = interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    const isAdmin = interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator);
    const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
    if (!canManageGuild && !isAdmin && !isGuildOwner) {
      return interaction.editReply({ content: 'You need Manage Server, Administrator, or server owner access to configure the economy.' });
    }

    const baseId = `economyconfig:${interaction.id}`;
    const initialEnabled = interaction.options.getBoolean('enabled');
    if (initialEnabled !== null) {
      await smiteConfigStore.setEnabled(interaction.guildId, initialEnabled);
    }

    const render = async () => {
      const config = smiteConfigStore.getConfig(interaction.guildId);
      const logChannelId = await resolveRupeeLogChannelId(interaction.guildId);
      const embed = buildEmbed(interaction.guild, config, logChannelId);
      const components = buildButtons(baseId, config.enabled, false);
      return { config, embed, components };
    };

    const view = await render();
    const reply = await interaction.editReply({
      embeds: [view.embed],
      components: view.components,
    });

    const collector = reply.createMessageComponentCollector({ time: SESSION_TIMEOUT_MS });

    collector.on('collect', async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        await componentInteraction.reply({ content: 'This configuration panel belongs to someone else.', ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:toggle`) {
        const current = smiteConfigStore.getConfig(interaction.guildId);
        await smiteConfigStore.setEnabled(interaction.guildId, !current.enabled);
        const nextView = await render();
        await componentInteraction.update({ embeds: [nextView.embed], components: nextView.components });
        return;
      }

      if (componentInteraction.customId === `${baseId}:rates`) {
        const current = smiteConfigStore.getConfig(interaction.guildId);
        const modalId = `${baseId}:modal:rates`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Edit Economy Earning Rates')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('message_threshold')
                .setLabel('Messages per 1 Currency')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(current.messageThreshold || smiteConfigStore.DEFAULT_MESSAGE_THRESHOLD)),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('voice_minutes')
                .setLabel('Voice minutes per 1 Currency')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(current.voiceMinutesPerRupee || smiteConfigStore.DEFAULT_VOICE_MINUTES_PER_RUPEE)),
            ),
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

        const messageThreshold = parsePositiveInteger(submission.fields.getTextInputValue('message_threshold'));
        const voiceMinutesPerRupee = parsePositiveInteger(submission.fields.getTextInputValue('voice_minutes'));
        if (!messageThreshold || !voiceMinutesPerRupee) {
          await submission.reply({
            content: 'Please enter whole numbers greater than 0 for both message and voice earning rates.',
            ephemeral: true,
          });
          return;
        }

        await smiteConfigStore.setEarningRates(interaction.guildId, {
          messageThreshold,
          voiceMinutesPerRupee,
        });
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await submission.reply({ content: 'Economy earning rates updated for this server.', ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:immunity`) {
        const modalId = `${baseId}:modal:immunity`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Set Immunity Role')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('immune_role')
                .setLabel('Role mention or ID (type "clear" to remove)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('<@&ROLE_ID> | ROLE_ID | clear'),
            ),
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

        const raw = (submission.fields.getTextInputValue('immune_role') || '').trim();
        if (!raw) {
          await submission.reply({ content: 'Please provide a role mention/ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await smiteConfigStore.setImmuneRoleIds(interaction.guildId, []);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await submission.reply({ content: 'Immunity role cleared for this server.', ephemeral: true });
          return;
        }

        const roleId = parseRoleId(raw);
        if (!roleId) {
          await submission.reply({ content: 'Invalid role format. Use a role mention, role ID, or `clear`.', ephemeral: true });
          return;
        }

        let role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
          try {
            role = await interaction.guild.roles.fetch(roleId);
          } catch (_) {
            role = null;
          }
        }
        if (!role) {
          await submission.reply({ content: 'That role does not exist in this server.', ephemeral: true });
          return;
        }

        await smiteConfigStore.setImmuneRoleIds(interaction.guildId, [role.id]);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await submission.reply({ content: `Immunity role set to ${role}.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:announce`) {
        const currencyName = getCurrencyName(interaction.guildId);
        const modalId = `${baseId}:modal:announce`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(trimModalTitle(`Set ${currencyName} Announce Channel`))
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('announce_channel')
                .setLabel('Channel mention or ID (type "clear" to remove)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('<#CHANNEL_ID> | CHANNEL_ID | clear'),
            ),
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

        const raw = (submission.fields.getTextInputValue('announce_channel') || '').trim();
        if (!raw) {
          await submission.reply({ content: 'Please provide a channel mention/ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await smiteConfigStore.setAnnounceChannelId(interaction.guildId, null);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await submission.reply({ content: `${currencyName} announce channel cleared.`, ephemeral: true });
          return;
        }

        const channelId = parseChannelId(raw);
        if (!channelId) {
          await submission.reply({ content: 'Invalid channel format. Use a channel mention, channel ID, or `clear`.', ephemeral: true });
          return;
        }

        let channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) {
          try {
            channel = await interaction.guild.channels.fetch(channelId);
          } catch (_) {
            channel = null;
          }
        }
        if (!channel || !channel.isTextBased?.() || channel.type === ChannelType.GuildForum) {
          await submission.reply({ content: 'Please select a text or announcement channel in this server.', ephemeral: true });
          return;
        }

        await smiteConfigStore.setAnnounceChannelId(interaction.guildId, channel.id);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await submission.reply({ content: `${currencyName} announce channel set to ${channel}.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:log`) {
        const currencyName = getCurrencyName(interaction.guildId);
        const modalId = `${baseId}:modal:log`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(trimModalTitle(`Set ${currencyName} Log Channel`))
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('log_channel')
                .setLabel('Channel mention or ID (type "clear" to remove)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('<#CHANNEL_ID> | CHANNEL_ID | clear'),
            ),
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

        const raw = (submission.fields.getTextInputValue('log_channel') || '').trim();
        if (!raw) {
          await submission.reply({ content: 'Please provide a channel mention/ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await logChannelTypeStore.setChannel(interaction.guildId, 'economy', null);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await submission.reply({ content: `${currencyName} log channel cleared.`, ephemeral: true });
          return;
        }

        const channelId = parseChannelId(raw);
        if (!channelId) {
          await submission.reply({ content: 'Invalid channel format. Use a channel mention, channel ID, or `clear`.', ephemeral: true });
          return;
        }

        let channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) {
          try {
            channel = await interaction.guild.channels.fetch(channelId);
          } catch (_) {
            channel = null;
          }
        }
        if (!channel || (!channel.isTextBased?.() && channel.type !== ChannelType.GuildForum)) {
          await submission.reply({ content: 'Please select a text, announcement, thread, or forum channel in this server.', ephemeral: true });
          return;
        }

        await logChannelTypeStore.setChannel(interaction.guildId, 'economy', channel.id);
        await logChannelTypeStore.setEnabled(interaction.guildId, 'economy', true);

        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await submission.reply({ content: `${currencyName} log channel set to ${channel}.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:currency`) {
        const modalId = `${baseId}:modal:currency`;
        const current = getCurrencyName(interaction.guildId);
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Set Currency Name')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('currency_name')
                .setLabel('Currency name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(32)
                .setPlaceholder('e.g. Rupee, Gem, Token')
                .setValue(current),
            ),
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

        const rawName = (submission.fields.getTextInputValue('currency_name') || '').trim();
        if (!rawName) {
          await submission.reply({ content: 'Currency name cannot be empty.', ephemeral: true });
          return;
        }

        await smiteConfigStore.setCurrencyName(interaction.guildId, rawName);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await submission.reply({
          content: `Currency name updated to **${formatCurrencyWord(interaction.guildId, 1)}**.`,
          ephemeral: true,
        });
        return;
      }

      if (componentInteraction.customId === `${baseId}:store`) {
        const modalId = `${baseId}:modal:store`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Edit Store Item Price')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('store_item_id')
                .setLabel('Store item ID or number')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('e.g. stfu or 1'),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('store_item_cost')
                .setLabel('Currency cost (or "default" to reset)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('e.g. 7 or default'),
            ),
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

        const rawItemId = submission.fields.getTextInputValue('store_item_id');
        const storeItemId = parseStoreItemId(rawItemId);
        if (!storeItemId) {
          await submission.reply({
            content: `Invalid store item. Use one of: ${SHOP_ITEMS.map((item, idx) => `${idx + 1}:${item.id}`).join(', ')}`,
            ephemeral: true,
          });
          return;
        }

        const item = STORE_ITEM_LOOKUP.get(storeItemId);
        const rawCost = (submission.fields.getTextInputValue('store_item_cost') || '').trim();
        const lowerCost = rawCost.toLowerCase();

        if (lowerCost === 'default' || lowerCost === 'reset' || lowerCost === 'clear') {
          await smiteConfigStore.setStoreItemCost(interaction.guildId, storeItemId, null);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await submission.reply({
            content: `${item?.label || storeItemId} cost reset to default (${item?.cost ?? 'unknown'}).`,
            ephemeral: true,
          });
          return;
        }

        const parsedCost = parsePositiveInteger(rawCost, { min: 1, max: 1_000_000 });
        if (!parsedCost) {
          await submission.reply({
            content: 'Invalid cost. Enter a whole number greater than 0, or `default`.',
            ephemeral: true,
          });
          return;
        }

        await smiteConfigStore.setStoreItemCost(interaction.guildId, storeItemId, parsedCost);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await submission.reply({
          content: `${item?.label || storeItemId} now costs ${formatCurrencyAmount(interaction.guildId, parsedCost, { lowercase: true })} in this server.`,
          ephemeral: true,
        });
      }
    });

    collector.on('end', async () => {
      try {
        const latest = smiteConfigStore.getConfig(interaction.guildId);
        await interaction.editReply({
          components: buildButtons(baseId, latest.enabled, true),
        });
      } catch (_) {}
    });
  },
};
