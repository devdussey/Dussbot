const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');

const srcDirForThisModule = __dirname.includes(`${path.sep}dist${path.sep}`)
  ? __dirname.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
  : path.join(process.cwd(), 'src', 'commands');

function requireFromSrcIfNeeded(modulePath) {
  try {
    return require(modulePath);
  } catch (_) {
    return require(path.resolve(srcDirForThisModule, modulePath));
  }
}

const smiteConfigStore = requireFromSrcIfNeeded('../utils/smiteConfigStore');
const logChannelTypeStore = requireFromSrcIfNeeded('../utils/logChannelTypeStore');
const coinStore = requireFromSrcIfNeeded('../utils/coinStore');
const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');
const { SHOP_ITEMS } = requireFromSrcIfNeeded('./storeconfig');
const { getCurrencyName, formatCurrencyAmount, formatCurrencyWord } = requireFromSrcIfNeeded('../utils/currencyName');

const HORSE_RACE_WIN_RUPEES = 1;
const SESSION_TIMEOUT_MS = 10 * 60_000;
const USER_DISPLAY_MAX_OPTIONS = 25;
const STORE_ITEM_LOOKUP = new Map<string, any>((SHOP_ITEMS || []).map(item => [String(item.id), item]));

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

async function replyToModal(submission, payload) {
  if (submission.deferred || submission.replied) {
    return submission.followUp(payload);
  }
  return submission.reply(payload);
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
  const storePanelDisplay = config.storePanelChannelId ? `<#${config.storePanelChannelId}>` : 'Not Configured';
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
      { name: `${currencyName} Store Panel Channel`, value: storePanelDisplay, inline: false },
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
        .setCustomId(`${baseId}:storepanel`)
        .setLabel('Set Store Panel Channel')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
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

function formatDateTime(value) {
  if (!value) return 'Never';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return 'Unknown';
  const unix = Math.floor(ts / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

async function buildUserDisplayState(interaction, selectedUserId) {
  const allEntries = coinStore.listUserSummaries(interaction.guildId, { minCoins: 0 });
  const eligibleEntries = allEntries.filter(entry => Number(entry?.coins) > 0);

  const selectableUsers = [];
  let totalEligible = 0;

  for (const entry of eligibleEntries) {
    const userId = String(entry?.userId || '');
    if (!userId) continue;

    let member = interaction.guild.members.cache.get(userId);
    if (!member) {
      try {
        // eslint-disable-next-line no-await-in-loop
        member = await interaction.guild.members.fetch(userId);
      } catch (_) {
        member = null;
      }
    }
    if (!member || member.user?.bot) continue;

    totalEligible += 1;
    if (selectableUsers.length < USER_DISPLAY_MAX_OPTIONS) {
      selectableUsers.push({ userId, member, summary: entry });
    }
  }

  const selectedEntry = selectedUserId
    ? eligibleEntries.find(entry => String(entry?.userId) === String(selectedUserId))
    : null;

  let selectedMember = null;
  if (selectedEntry?.userId) {
    selectedMember = interaction.guild.members.cache.get(selectedEntry.userId);
    if (!selectedMember) {
      try {
        selectedMember = await interaction.guild.members.fetch(selectedEntry.userId);
      } catch (_) {
        selectedMember = null;
      }
    }
  }

  return {
    totalTracked: allEntries.length,
    totalEligible,
    truncatedCount: Math.max(0, totalEligible - selectableUsers.length),
    selectableUsers,
    selectedEntry: selectedMember?.user?.bot ? null : selectedEntry,
    selectedMember: selectedMember?.user?.bot ? null : selectedMember,
  };
}

function buildUserDisplayEmbed(interaction, state) {
  const currencyWord = formatCurrencyWord(interaction.guildId, 2, { lowercase: true });
  const base = new EmbedBuilder()
    .setColor(resolveEmbedColour(interaction.guildId, 0x00f0ff))
    .setTitle('Economy User Display')
    .setTimestamp();

  if (!state.selectedEntry || !state.selectedMember) {
    let description = `Select a member with tracked ${currencyWord} to view and manage their profile.`;
    description += `\n\nEligible members: **${state.totalEligible}**`;
    if (state.truncatedCount > 0) {
      description += `\nShowing top **${USER_DISPLAY_MAX_OPTIONS}** by balance (${state.truncatedCount} more not shown).`;
    }
    if (state.totalTracked > state.totalEligible) {
      description += `\nTracked users with zero balance or missing membership: **${state.totalTracked - state.totalEligible}**.`;
    }

    return base.setDescription(description);
  }

  const member = state.selectedMember;
  const summary = state.selectedEntry;
  const createdUnix = member.user?.createdTimestamp ? Math.floor(member.user.createdTimestamp / 1000) : null;
  const joinedUnix = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
  const netFlow = Number(summary.lifetimeEarned || 0) - Number(summary.lifetimeSpent || 0);

  return base
    .setTitle(`Economy User Display - ${member.displayName}`)
    .setDescription(`Managing <@${member.id}>`)
    .addFields(
      { name: 'Current Balance', value: `**${formatCurrencyAmount(interaction.guildId, summary.coins, { lowercase: true })}**`, inline: true },
      { name: 'Lifetime Earned', value: formatCurrencyAmount(interaction.guildId, summary.lifetimeEarned, { lowercase: true }), inline: true },
      { name: 'Lifetime Spent', value: formatCurrencyAmount(interaction.guildId, summary.lifetimeSpent, { lowercase: true }), inline: true },
      { name: 'Net Flow', value: formatCurrencyAmount(interaction.guildId, netFlow, { lowercase: true }), inline: true },
      { name: 'Last Blessing Claim', value: formatDateTime(summary.lastPrayAt), inline: false },
      { name: 'Joined Server', value: joinedUnix ? `<t:${joinedUnix}:F> (<t:${joinedUnix}:R>)` : 'Unknown', inline: false },
      { name: 'Account Created', value: createdUnix ? `<t:${createdUnix}:F> (<t:${createdUnix}:R>)` : 'Unknown', inline: false },
    );
}

function buildUserDisplayComponents(baseId, state, selectedUserId, disabled = false) {
  const options = state.selectableUsers.map((entry) => ({
    label: String(entry.member.displayName || entry.member.user?.username || entry.userId).slice(0, 100),
    value: entry.userId,
    description: formatCurrencyAmount(entry.member.guild.id, entry.summary.coins, { lowercase: true }).slice(0, 100),
    default: String(entry.userId) === String(selectedUserId),
  }));

  if (!options.length) {
    options.push({
      label: 'No eligible users',
      value: 'none',
      description: 'No members currently have currency.',
      default: true,
    });
  }

  const userMenu = new StringSelectMenuBuilder()
    .setCustomId(`${baseId}:select`)
    .setPlaceholder('Select a member with currency')
    .setDisabled(disabled || !state.selectableUsers.length)
    .addOptions(options);

  const hasSelected = Boolean(state.selectedEntry && state.selectedMember);
  const resetButton = new ButtonBuilder()
    .setCustomId(`${baseId}:reset`)
    .setLabel('Reset Currency')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled || !hasSelected);

  const giveButton = new ButtonBuilder()
    .setCustomId(`${baseId}:give`)
    .setLabel('Give Currency')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled || !hasSelected);

  return [
    new ActionRowBuilder().addComponents(userMenu),
    new ActionRowBuilder().addComponents(resetButton, giveButton),
  ];
}

async function runUserDisplayPanel(interaction) {
  const baseId = `economyconfig:userdisplay:${interaction.id}`;
  let selectedUserId = null;

  const render = async (disabled = false) => {
    const state = await buildUserDisplayState(interaction, selectedUserId);
    if (!state.selectedEntry || !state.selectedMember) {
      selectedUserId = null;
    }
    const embed = buildUserDisplayEmbed(interaction, state);
    const components = buildUserDisplayComponents(baseId, state, selectedUserId, disabled);
    return { state, embed, components };
  };

  const initialView = await render(false);
  const reply = await interaction.editReply({
    embeds: [initialView.embed],
    components: initialView.components,
  });

  const collector = reply.createMessageComponentCollector({ time: SESSION_TIMEOUT_MS });

  collector.on('collect', async (componentInteraction) => {
    if (componentInteraction.user.id !== interaction.user.id) {
      await componentInteraction.reply({ content: 'This configuration panel belongs to someone else.', ephemeral: true });
      return;
    }

    if (componentInteraction.customId === `${baseId}:select`) {
      const picked = componentInteraction.values?.[0];
      selectedUserId = picked === 'none' ? null : picked;
      const nextView = await render(false);
      await componentInteraction.update({ embeds: [nextView.embed], components: nextView.components });
      return;
    }

    if (componentInteraction.customId === `${baseId}:reset`) {
      if (!selectedUserId) {
        await componentInteraction.reply({ content: 'Select a user first.', ephemeral: true });
        return;
      }

      await coinStore.resetUser(interaction.guildId, selectedUserId);
      const nextView = await render(false);
      await componentInteraction.update({ embeds: [nextView.embed], components: nextView.components });
      return;
    }

    if (componentInteraction.customId === `${baseId}:give`) {
      if (!selectedUserId) {
        await componentInteraction.reply({ content: 'Select a user first.', ephemeral: true });
        return;
      }

      const modalId = `${baseId}:modal:give:${componentInteraction.id}`;
      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Give Currency')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('give_amount')
              .setLabel('Amount to give')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('Whole number, e.g. 25'),
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

      const amount = parsePositiveInteger(submission.fields.getTextInputValue('give_amount'), { min: 1, max: 1_000_000 });
      if (!amount) {
        await replyToModal(submission, { content: 'Please provide a whole number greater than 0.', ephemeral: true });
        return;
      }

      await coinStore.addCoins(interaction.guildId, selectedUserId, amount);
      const nextView = await render(false);
      await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
      await replyToModal(submission, {
        content: `Added ${formatCurrencyAmount(interaction.guildId, amount, { lowercase: true })}.`,
        ephemeral: true,
      });
    }
  });

  collector.on('end', async () => {
    try {
      const finalView = await render(true);
      await interaction.editReply({
        embeds: [finalView.embed],
        components: finalView.components,
      });
    } catch (_) {}
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economyconfig')
    .setDescription('Configure economy settings or manage user currency')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('settings')
        .setDescription('Open the economy settings panel')
        .addBooleanOption(opt =>
          opt
            .setName('enabled')
            .setDescription('Turn economy rewards on or off before opening the config view')
            .setRequired(false),
        ))
    .addSubcommand(sub =>
      sub
        .setName('userdisplay')
        .setDescription('View and manage currency for members with a tracked balance')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand(false) || 'settings';

    const canManageGuild = interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    const isAdmin = interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator);
    const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
    if (!canManageGuild && !isAdmin && !isGuildOwner) {
      return interaction.editReply({ content: 'You need Manage Server, Administrator, or server owner access to configure the economy.' });
    }
    if (subcommand === 'userdisplay') {
      await runUserDisplayPanel(interaction);
      return;
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
        const modalId = `${baseId}:modal:rates:${componentInteraction.id}`;
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
          await replyToModal(submission, {
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
        await replyToModal(submission, { content: 'Economy earning rates updated for this server.', ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:immunity`) {
        const modalId = `${baseId}:modal:immunity:${componentInteraction.id}`;
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
          await replyToModal(submission, { content: 'Please provide a role mention/ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await smiteConfigStore.setImmuneRoleIds(interaction.guildId, []);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await replyToModal(submission, { content: 'Immunity role cleared for this server.', ephemeral: true });
          return;
        }

        const roleId = parseRoleId(raw);
        if (!roleId) {
          await replyToModal(submission, { content: 'Invalid role format. Use a role mention, role ID, or `clear`.', ephemeral: true });
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
          await replyToModal(submission, { content: 'That role does not exist in this server.', ephemeral: true });
          return;
        }

        await smiteConfigStore.setImmuneRoleIds(interaction.guildId, [role.id]);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await replyToModal(submission, { content: `Immunity role set to ${role}.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:announce`) {
        const currencyName = getCurrencyName(interaction.guildId);
        const modalId = `${baseId}:modal:announce:${componentInteraction.id}`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(trimModalTitle(`Set ${currencyName} Announce Channel`))
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('announce_channel')
                .setLabel('Channel ID (type "clear" to remove)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('CHANNEL_ID | clear'),
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
          await replyToModal(submission, { content: 'Please provide a channel ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await smiteConfigStore.setAnnounceChannelId(interaction.guildId, null);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await replyToModal(submission, { content: `${currencyName} announce channel cleared.`, ephemeral: true });
          return;
        }

        const channelId = raw.match(/^\d{15,22}$/)?.[0] || null;
        if (!channelId) {
          await replyToModal(submission, { content: 'Invalid channel ID. Use a numeric channel ID or `clear`.', ephemeral: true });
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
          await replyToModal(submission, { content: 'Please select a text or announcement channel in this server.', ephemeral: true });
          return;
        }

        await smiteConfigStore.setAnnounceChannelId(interaction.guildId, channel.id);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await replyToModal(submission, { content: `${currencyName} announce channel set to ${channel}.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:log`) {
        const currencyName = getCurrencyName(interaction.guildId);
        const modalId = `${baseId}:modal:log:${componentInteraction.id}`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(trimModalTitle(`Set ${currencyName} Log Channel`))
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('log_channel')
                .setLabel('Channel mention/ID (type "clear" to remove)')
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
          await replyToModal(submission, { content: 'Please provide a channel mention/ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await logChannelTypeStore.setChannel(interaction.guildId, 'economy', null);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await replyToModal(submission, { content: `${currencyName} log channel cleared.`, ephemeral: true });
          return;
        }

        const channelId = parseChannelId(raw);
        if (!channelId) {
          await replyToModal(submission, { content: 'Invalid channel format. Use a channel mention, channel ID, or `clear`.', ephemeral: true });
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
          await replyToModal(submission, { content: 'Please select a text, announcement, thread, or forum channel in this server.', ephemeral: true });
          return;
        }

        await logChannelTypeStore.setChannel(interaction.guildId, 'economy', channel.id);
        await logChannelTypeStore.setEnabled(interaction.guildId, 'economy', true);

        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await replyToModal(submission, { content: `${currencyName} log channel set to ${channel}.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:storepanel`) {
        const currencyName = getCurrencyName(interaction.guildId);
        const modalId = `${baseId}:modal:storepanel:${componentInteraction.id}`;
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(trimModalTitle(`Set ${currencyName} Store Panel Channel`))
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('store_panel_channel')
                .setLabel('Channel mention/ID (type "clear" to remove)')
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

        const raw = (submission.fields.getTextInputValue('store_panel_channel') || '').trim();
        if (!raw) {
          await replyToModal(submission, { content: 'Please provide a channel mention/ID, or `clear`.', ephemeral: true });
          return;
        }

        if (raw.toLowerCase() === 'clear') {
          await smiteConfigStore.setStorePanelChannelId(interaction.guildId, null);
          const nextView = await render();
          await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
          await replyToModal(submission, { content: `${currencyName} store panel channel cleared.`, ephemeral: true });
          return;
        }

        const channelId = parseChannelId(raw);
        if (!channelId) {
          await replyToModal(submission, { content: 'Invalid channel format. Use a channel mention, channel ID, or `clear`.', ephemeral: true });
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
          await replyToModal(submission, { content: 'Please select a text or announcement channel in this server.', ephemeral: true });
          return;
        }

        const me = interaction.guild.members.me;
        const perms = channel.permissionsFor(me);
        if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
          await replyToModal(submission, { content: `I cannot send messages in ${channel}.`, ephemeral: true });
          return;
        }

        await smiteConfigStore.setStorePanelChannelId(interaction.guildId, channel.id);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await replyToModal(submission, { content: `${currencyName} store panel channel set to ${channel}. Run /storeconfig post to publish enabled store item embeds.`, ephemeral: true });
        return;
      }

      if (componentInteraction.customId === `${baseId}:currency`) {
        const modalId = `${baseId}:modal:currency:${componentInteraction.id}`;
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
          await replyToModal(submission, { content: 'Currency name cannot be empty.', ephemeral: true });
          return;
        }

        await smiteConfigStore.setCurrencyName(interaction.guildId, rawName);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await replyToModal(submission, {
          content: `Currency name updated to **${formatCurrencyWord(interaction.guildId, 1)}**.`,
          ephemeral: true,
        });
        return;
      }

      if (componentInteraction.customId === `${baseId}:store`) {
        const modalId = `${baseId}:modal:store:${componentInteraction.id}`;
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
          await replyToModal(submission, {
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
          await replyToModal(submission, {
            content: `${item?.label || storeItemId} cost reset to default (${item?.cost ?? 'unknown'}).`,
            ephemeral: true,
          });
          return;
        }

        const parsedCost = parsePositiveInteger(rawCost, { min: 1, max: 1_000_000 });
        if (!parsedCost) {
          await replyToModal(submission, {
            content: 'Invalid cost. Enter a whole number greater than 0, or `default`.',
            ephemeral: true,
          });
          return;
        }

        await smiteConfigStore.setStoreItemCost(interaction.guildId, storeItemId, parsedCost);
        const nextView = await render();
        await interaction.editReply({ embeds: [nextView.embed], components: nextView.components });
        await replyToModal(submission, {
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

export {};
