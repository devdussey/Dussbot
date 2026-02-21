const path = require('node:path');
const { Events, PermissionsBitField, EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require('discord.js');
const securityLogger = require('../utils/securityLogger');
const antiNukeManager = require('../utils/antiNukeManager');
const logSender = require('../utils/logSender');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const logConfigManager = require('../utils/logConfigManager');
const logConfigView = require('../utils/logConfigView');
const { buildLogEmbed } = require('../utils/logEmbedFactory');
const botConfigStore = require('../utils/botConfigStore');
const botConfigView = require('../utils/botConfigView');
const botSettingsView = require('../utils/botSettingsView');
const modLogStore = require('../utils/modLogStore');
const reactionRoleStore = require('../utils/reactionRoleStore');
const reactionRoleManager = require('../utils/reactionRoleManager');
const boosterManager = require('../utils/boosterRoleManager');
const boosterStore = require('../utils/boosterRoleStore');
const boosterConfigStore = require('../utils/boosterRoleConfigStore');
const { setDefaultColour, toHex6 } = require('../utils/guildColourStore');
const roleCleanManager = require('../utils/roleCleanManager');
const sacrificeNominationStore = require('../utils/sacrificeNominationStore');
const rupeeStore = require('../utils/rupeeStore');
const { isOwner } = require('../utils/ownerIds');
const { formatCurrencyAmount } = require('../utils/currencyName');
const { executeCommandSafely } = require('../utils/commandExecutionGuard');

const MAX_ERROR_STACK = 3500;
const COMMAND_FAILURE_ALERT_CHANNEL_ID = (process.env.COMMAND_FAILURE_ALERT_CHANNEL_ID || '').trim();
const OPTIONAL_COMMAND_MODULE_CACHE = new Map();
const OPTIONAL_COMMAND_MODULE_WARNED = new Set();

function resolveOptionalCommandModule(commandName) {
    if (OPTIONAL_COMMAND_MODULE_CACHE.has(commandName)) {
        return OPTIONAL_COMMAND_MODULE_CACHE.get(commandName);
    }

    const candidates = [
        path.join(__dirname, '..', 'commands', commandName),
        path.join(process.cwd(), 'dist', 'commands', commandName),
        path.join(process.cwd(), 'src', 'commands', commandName),
    ];

    let lastError = null;
    for (const modulePath of candidates) {
        try {
            const loaded = require(modulePath);
            OPTIONAL_COMMAND_MODULE_CACHE.set(commandName, loaded);
            return loaded;
        } catch (error) {
            lastError = error;
        }
    }

    OPTIONAL_COMMAND_MODULE_CACHE.set(commandName, null);
    if (!OPTIONAL_COMMAND_MODULE_WARNED.has(commandName)) {
        OPTIONAL_COMMAND_MODULE_WARNED.add(commandName);
        const detail = lastError?.message ? String(lastError.message) : String(lastError || 'unknown error');
        console.warn(`Optional command module "${commandName}" is unavailable: ${detail}`);
    }
    return null;
}

function getHelpCommandModule() {
    return resolveOptionalCommandModule('help');
}

function getStoreConfigCommandModule() {
    return resolveOptionalCommandModule('storeconfig');
}

function getAutorespondCommandModule() {
    return resolveOptionalCommandModule('autorespond');
}

function getVanityRoleCommandModule() {
    return resolveOptionalCommandModule('vanityrole');
}

function getHelpCategoryIdPrefix() {
    const helpCommand = getHelpCommandModule();
    if (typeof helpCommand?.HELP_CATEGORY_ID_PREFIX === 'string' && helpCommand.HELP_CATEGORY_ID_PREFIX.trim()) {
        return helpCommand.HELP_CATEGORY_ID_PREFIX;
    }
    return 'help-category';
}

function truncate(value, max = 1024, fallback = 'Unknown') {
    if (value === undefined || value === null) return fallback;
    const str = String(value);
    if (!str.trim()) return fallback;
    return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

function formatErrorStack(error) {
    const raw = error?.stack || error?.message;
    if (!raw) return null;
    const str = String(raw);
    return str.length > MAX_ERROR_STACK ? `${str.slice(0, MAX_ERROR_STACK - 3)}...` : str;
}

async function notifyCommandFailureAlert(interaction, error, context) {
    if (!COMMAND_FAILURE_ALERT_CHANNEL_ID || !interaction?.client) return;

    try {
        const channel = interaction.client.channels.cache.get(COMMAND_FAILURE_ALERT_CHANNEL_ID)
            || await interaction.client.channels.fetch(COMMAND_FAILURE_ALERT_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased?.()) return;

        const guildName = interaction.guild?.name || 'Unknown';
        const guildId = interaction.guildId || interaction.guild?.id || 'Unknown';
        const channelLabel = interaction.channel ? `<#${interaction.channel.id}> (${interaction.channel.id})` : 'Unknown';
        const reasonCode = error?.code || error?.status;
        const reason = reasonCode
            ? `${truncate(error?.message || 'Unknown error', 900)} (code: ${reasonCode})`
            : truncate(error?.message || 'Unknown error', 900);

        const embed = new EmbedBuilder()
            .setTitle('Command Failed')
            .setColor(0xed4245)
            .setTimestamp()
            .addFields(
                { name: 'Server', value: `${truncate(guildName, 200)} (${guildId})`, inline: false },
                { name: 'Command', value: `/${interaction.commandName || 'unknown'}`, inline: true },
                { name: 'User', value: `${interaction.user?.tag || 'Unknown'} (${interaction.user?.id || 'unknown'})`, inline: true },
                { name: 'Channel', value: channelLabel, inline: false },
                { name: 'Reason', value: reason, inline: false },
            );

        if (context) {
            embed.addFields({ name: 'Context', value: truncate(context, 1024), inline: false });
        }

        const stack = formatErrorStack(error);
        if (stack) {
            const shortStack = stack.length > 1500 ? `${stack.slice(0, 1497)}...` : stack;
            embed.setDescription('```\n' + shortStack + '\n```');
        }

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.warn('Failed to notify command failure alert channel:', err?.message || err);
    }
}

function collectAntiNukeChangeLines(before, after) {
    const changes = [];
    if (!before || !after) return changes;

    const compareBool = (path, label) => {
        const beforeValue = Boolean(path(before));
        const afterValue = Boolean(path(after));
        if (beforeValue !== afterValue) {
            changes.push(`${label}: ${beforeValue ? 'Enabled' : 'Disabled'} -> ${afterValue ? 'Enabled' : 'Disabled'}`);
        }
    };

    const compareThreshold = (typeLabel, beforeDet, afterDet) => {
        if (!beforeDet || !afterDet) return;
        if (Number(beforeDet.threshold) !== Number(afterDet.threshold) || Number(beforeDet.windowSec) !== Number(afterDet.windowSec)) {
            changes.push(
                `${typeLabel}: ${beforeDet.threshold}/${beforeDet.windowSec}s -> ${afterDet.threshold}/${afterDet.windowSec}s`,
            );
        }
    };

    compareBool(cfg => cfg.enabled, 'Anti-nuke');
    compareBool(cfg => cfg.autoJail, 'Auto jail');
    compareBool(cfg => cfg.notifyOwners, 'Owner DM alerts');
    compareBool(cfg => cfg.streamAlerts, 'Stream alerts');
    compareBool(cfg => cfg.ignoreBots, 'Ignore bots');
    compareBool(cfg => cfg.detections?.channelDelete?.enabled, 'Channel delete detection');
    compareBool(cfg => cfg.detections?.roleDelete?.enabled, 'Role delete detection');

    compareThreshold('Channel delete threshold', before.detections?.channelDelete, after.detections?.channelDelete);
    compareThreshold('Role delete threshold', before.detections?.roleDelete, after.detections?.roleDelete);
    return changes;
}

async function logAntiNukeConfigChange(interaction, beforeConfig, afterConfig) {
    if (!interaction?.guildId || !interaction?.guild || !interaction?.client || !beforeConfig || !afterConfig) return;
    const changeLines = collectAntiNukeChangeLines(beforeConfig, afterConfig);
    if (!changeLines.length) return;

    const enabledChanged = Boolean(beforeConfig.enabled) !== Boolean(afterConfig.enabled);
    const action = enabledChanged
        ? (afterConfig.enabled ? 'Anti-Nuke Enabled' : 'Anti-Nuke Disabled')
        : 'Anti-Nuke Edited';
    const logType = enabledChanged
        ? (afterConfig.enabled ? 'antinuke_enabled' : 'antinuke_disabled')
        : 'antinuke_edited';

    const embed = buildLogEmbed({
        action,
        target: interaction.user,
        actor: interaction.user,
        reason: changeLines.join('\n').slice(0, 1024),
        color: enabledChanged ? (afterConfig.enabled ? 0x57f287 : 0xed4245) : 0xf1c40f,
        extraFields: [
            { name: 'Command', value: '/antinuke config', inline: true },
            { name: 'Channel', value: interaction.channel ? `<#${interaction.channel.id}>` : 'Unknown', inline: true },
        ],
    });

    await logSender.sendLog({
        guildId: interaction.guildId,
        logType,
        embed,
        client: interaction.client,
    });

    if (enabledChanged && changeLines.length > 1) {
        const editedEmbed = buildLogEmbed({
            action: 'Anti-Nuke Edited',
            target: interaction.user,
            actor: interaction.user,
            reason: changeLines.join('\n').slice(0, 1024),
            color: 0xf1c40f,
            extraFields: [{ name: 'Command', value: '/antinuke config', inline: true }],
        });
        await logSender.sendLog({
            guildId: interaction.guildId,
            logType: 'antinuke_edited',
            embed: editedEmbed,
            client: interaction.client,
        });
    }
}

async function logCommandUsage(interaction, status, details, color = 0x5865f2) {
    if (!interaction.guildId) return;
    const fields = [
        { name: 'Command', value: `/${interaction.commandName}`, inline: true },
        { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
    ];
    if (interaction.channel) {
        fields.push({ name: 'Channel', value: `<#${interaction.channel.id}> (${interaction.channel.id})`, inline: true });
    }
    if (details) {
        fields.push({ name: 'Details', value: truncate(details, 1024), inline: false });
    }
    const embed = new EmbedBuilder()
        .setTitle(`Command ${status}`)
        .setColor(color)
        .addFields(fields)
        .setTimestamp();
    try {
        await logSender.sendLog({
            guildId: interaction.guildId,
            logType: 'command',
            embed,
            client: interaction.client,
        });
    } catch (err) {
        console.error('Failed to log command usage:', err);
    }
}

async function logCommandError(interaction, error, context) {
    if (!interaction.guildId) return;
    const fields = [
        { name: 'Command', value: `/${interaction.commandName}`, inline: true },
        { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
    ];
    if (interaction.channel) {
        fields.push({ name: 'Channel', value: `<#${interaction.channel.id}> (${interaction.channel.id})`, inline: true });
    }
    if (context) {
        fields.push({ name: 'Context', value: truncate(context), inline: false });
    }
    fields.push({ name: 'Error', value: truncate(error?.message || 'Unknown error'), inline: false });

    const stack = formatErrorStack(error);
    const embed = new EmbedBuilder()
        .setTitle('Command Error')
        .setColor(0xed4245)
        .addFields(fields)
        .setTimestamp();

    if (stack) {
        embed.setDescription('```\n' + stack + '\n```');
    }

    try {
        await logSender.sendLog({
            guildId: interaction.guildId,
            logType: 'command_error',
            embed,
            client: interaction.client,
        });
    } catch (err) {
        console.error('Failed to log command error:', err);
    }
}

async function fetchMember(guild, userId) {
    if (!guild || !userId) return null;
    try { return await guild.members.fetch(userId); } catch (_) { return null; }
}

function isActiveBooster(member, premiumRoleId) {
    if (!member) return false;
    const hasBoost = Boolean(member.premiumSince || member.premiumSinceTimestamp);
    const hasPremiumRole = premiumRoleId ? member.roles?.cache?.has(premiumRoleId) : false;
    return hasBoost || hasPremiumRole;
}

function buildSacrificeNominationRow(channelId) {
    const menu = new UserSelectMenuBuilder()
        .setCustomId(`sacrifice:nominate:${channelId}`)
        .setPlaceholder('Nominate a user for sacrifice')
        .setMinValues(1)
        .setMaxValues(1);
    return new ActionRowBuilder().addComponents(menu);
}

function formatSacrificeCooldown(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.max(1, Math.ceil(safeMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    return parts.length ? parts.join(' ') : '0s';
}

const COMMAND_CATEGORY_MAP = {
    // Logging
    logconfig: 'logging',

    // Moderation
    ban: 'moderation',
    banlist: 'moderation',
    kick: 'moderation',
    mute: 'moderation',
    restrainingorder: 'moderation',

    // AI
    analysis: 'ai',
    chat: 'ai',
    summarize: 'ai',
    transcribe: 'ai',
    transriptconfig: 'ai',

    // Admin / Owner
    antinuke: 'admin',
    boosterroleconfig: 'admin',
    debug: 'admin',
    emoji: 'admin',
    embed: 'admin',
    donate: 'admin',
    massblessing: 'admin',
    purge: 'admin',
    sacrificeconfig: 'admin',
    say: 'admin',
    sticker: 'admin',
    vanityrole: 'admin',
    webhooks: 'admin',
    reactionrole: 'admin',

    // Economy
    economyconfig: 'economy',
    balance: 'economy',
    storeconfig: 'economy',
    viewbalance: 'economy',

    // Games
    blessing: 'games',
    carpetsurfconfig: 'games',
    casino: 'games',
    wordrush: 'games',

    // Automations
    automessage: 'automations',
    autorespond: 'automations',
    autoroles: 'automations',
    stickymessage: 'automations',

    // Images
    image: 'images',
    imagefilter: 'images',

    // Utility
    botinfo: 'utility',
    help: 'utility',
    premium: 'utility',
    wordstats: 'utility',
};

function getCategoryLabel(key) {
  return botConfigStore.getCategoryDefinition(key)?.label || key || 'This category';
}

function canManageBotSettings(interaction) {
    if (!interaction?.inGuild?.() || !interaction.member) return false;
    const hasAdmin = interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator);
    const isGuildOwner = interaction.guild?.ownerId === interaction.user?.id;
    const isBotOwner = isOwner(interaction.user?.id);
    return Boolean(hasAdmin || isGuildOwner || isBotOwner);
}

const MODERATOR_COMMANDS = new Set(['ban', 'banlist', 'kick', 'mute', 'unban', 'unmute']);
const OWNER_COMMANDS = new Set([]);
const ADMIN_COMMANDS = new Set([
  'analysis',
  'antinuke',
  'automessage',
  'autoroles',
  'autorespond',
  'blessing',
  'botconfig',
  'botlook',
  'botsettings',
  'carpetsurfconfig',
  'channel',
  'chat',
  'confessconfig',
  'debug',
  'embed',
  'donate',
  'logconfig',
  'massblessing',
  'purge',
  'reactionrole',
  'role',
  'sacrificeconfig',
  'say',
  'stickymessage',
  'storeconfig',
  'summarize',
  'transcribe',
  'transriptconfig',
  'vanityrole',
  'viewbalance',
  'webhooks',
  'wordrush',
]);
const ALWAYS_ENABLED_COMMANDS = new Set([]);
const MANAGE_GUILD_COMMANDS = new Set([
  'boosterroleconfig',
  'modconfig',
  'economyconfig',
  'searchword',
]);

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Handle slash and right-click application commands
        if (interaction.isChatInputCommand() || interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
            const isChatInput = interaction.isChatInputCommand();
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                try {
                    const logger = require('../utils/securityLogger');
                    await logger.logMissingCommand(interaction);
                } catch (_) {}
                const missingCommandError = new Error('Command handler missing');
                const missingCommandContext = isChatInput
                    ? 'Slash command was invoked but no matching handler is registered.'
                    : 'Context menu command was invoked but no matching handler is registered.';
                await logCommandError(
                    interaction,
                    missingCommandError,
                    missingCommandContext,
                );
                await notifyCommandFailureAlert(
                    interaction,
                    missingCommandError,
                    missingCommandContext,
                );
                return;
            }

            if (isChatInput) {
                const cmdName = interaction.commandName;
                const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
                const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
                const isBotOwner = isOwner(interaction.user.id);
                if (OWNER_COMMANDS.has(cmdName) && !isOwner(interaction.user.id)) {
                    try { await interaction.reply({ content: 'Only the bot owner can run this command.', ephemeral: true }); } catch (_) {}
                    try { await securityLogger.logPermissionDenied(interaction, cmdName, 'User is not a bot owner'); } catch (_) {}
                    return;
                }

                if (MODERATOR_COMMANDS.has(cmdName)) {
                    if (!interaction.inGuild()) {
                        try { await interaction.reply({ content: 'Use this command in a server.', ephemeral: true }); } catch (_) {}
                        return;
                    }
                    const modRoleId = await modLogStore.getModeratorRole(interaction.guildId);
                    const hasModRole = Boolean(modRoleId && interaction.member?.roles?.cache?.has(modRoleId));
                    if (!hasModRole && !isAdmin && !isGuildOwner && !isBotOwner) {
                        const message = modRoleId
                            ? 'The configured moderator role is required to run this command.'
                            : 'No moderator role is configured; ask an admin to run /modconfig.';
                        try { await interaction.reply({ content: message, ephemeral: true }); } catch (_) {}
                        try { await securityLogger.logPermissionDenied(interaction, cmdName, 'User missing moderator role'); } catch (_) {}
                        return;
                    }
                }

                if (ADMIN_COMMANDS.has(cmdName)) {
                    if (!interaction.inGuild()) {
                        try { await interaction.reply({ content: 'Use this command in a server.', ephemeral: true }); } catch (_) {}
                        return;
                    }
                    const allowBotSettingsOwnerBypass = cmdName === 'botsettings' && (isGuildOwner || isOwner(interaction.user.id));
                    if (!isAdmin && !allowBotSettingsOwnerBypass) {
                        try { await interaction.reply({ content: 'Administrator permission is required to use this command.', ephemeral: true }); } catch (_) {}
                        try { await securityLogger.logPermissionDenied(interaction, cmdName, 'User missing Administrator'); } catch (_) {}
                        return;
                    }
                }

                if (MANAGE_GUILD_COMMANDS.has(cmdName)) {
                    if (!interaction.inGuild()) {
                        try { await interaction.reply({ content: 'Use this command in a server.', ephemeral: true }); } catch (_) {}
                        return;
                    }
                    const canManageGuild = interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
                    if (!canManageGuild) {
                        try { await interaction.reply({ content: 'Manage Server permission is required to use this command.', ephemeral: true }); } catch (_) {}
                        try { await securityLogger.logPermissionDenied(interaction, cmdName, 'User missing ManageGuild'); } catch (_) {}
                        return;
                    }
                }

                const categoryKey = COMMAND_CATEGORY_MAP[interaction.commandName];
                const skipCategoryEnabledCheck = ALWAYS_ENABLED_COMMANDS.has(interaction.commandName);
                let defaultEphemeral = null;
                if (categoryKey && interaction.inGuild()) {
                    defaultEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, categoryKey, true);
                    if (!skipCategoryEnabledCheck && !botConfigStore.isCategoryEnabled(interaction.guildId, categoryKey, true)) {
                        const label = getCategoryLabel(categoryKey);
                        const content = `${label} commands are disabled by a server admin.`;
                        try {
                            await interaction.reply({ content, ephemeral: defaultEphemeral });
                        } catch (replyError) {
                            const rcode = replyError?.code;
                            if (rcode !== 40060 && rcode !== 10062) {
                                try { await interaction.followUp({ content, ephemeral: true }); } catch (_) {}
                            }
                        }
                        return;
                    }

                    const wrapEphemeral = (fn) => (options) => {
                        if (options === undefined) {
                            return fn({ ephemeral: defaultEphemeral });
                        }
                        if (typeof options === 'string') {
                            return fn({ content: options, ephemeral: defaultEphemeral });
                        }
                        if (options && typeof options === 'object' && !Object.prototype.hasOwnProperty.call(options, 'ephemeral')) {
                            return fn({ ...options, ephemeral: defaultEphemeral });
                        }
                        return fn(options);
                    };

                    interaction.defaultEphemeral = defaultEphemeral;
                    interaction.reply = wrapEphemeral(interaction.reply.bind(interaction));
                    interaction.followUp = wrapEphemeral(interaction.followUp.bind(interaction));
                    interaction.deferReply = wrapEphemeral(interaction.deferReply.bind(interaction));
                }
            }

            const success = await executeCommandSafely({
                interaction,
                command,
                onSuccess: async () => {
                    await logCommandUsage(interaction, 'Used', 'Command executed successfully', 0x57f287);
                },
                onFailure: async (error) => {
                const code = error?.code || error?.status;
                const msg = (error?.message || '').toLowerCase();
                // Ignore common race/expiry cases to prevent noisy logs and dupes
                if (code === 40060 || code === 10062 || msg.includes('already been acknowledged') || msg.includes('unknown interaction')) {
                    console.warn(`Interaction for /${interaction.commandName} expired or was handled elsewhere (code ${code}).`);
                    return false;
                }

                console.error(`Error executing ${interaction.commandName}:`, error);
                await logCommandUsage(interaction, 'Failed', error?.message || 'Unknown error', 0xed4245);
                await logCommandError(interaction, error, 'Command execution threw an error.');
                await notifyCommandFailureAlert(interaction, error, 'Command execution threw an error.');
                    return true;
                },
            });
            if (success === false) return;
        }

        // Handle select menus
        if (interaction.isStringSelectMenu()) {
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('autorespond:list:')) {
                const autorespondCommand = getAutorespondCommandModule();
                if (typeof autorespondCommand?.handleSelectMenu !== 'function') {
                    try { await interaction.reply({ content: 'Autorespond tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await autorespondCommand.handleSelectMenu(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle autorespond select menu:', err);
                    try { await interaction.reply({ content: 'Autorespond action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('store:')) {
                const storeConfigCommand = getStoreConfigCommandModule();
                if (typeof storeConfigCommand?.handleStoreStringSelect !== 'function') {
                    try { await interaction.reply({ content: 'Store tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await storeConfigCommand.handleStoreStringSelect(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle store string select:', err);
                    try { await interaction.reply({ content: 'Store action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            const helpCategoryIdPrefix = getHelpCategoryIdPrefix();
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith(`${helpCategoryIdPrefix}:`)) {
                const ownerId = interaction.customId.slice(`${helpCategoryIdPrefix}:`.length).trim();
                if (ownerId && interaction.user.id !== ownerId) {
                    try { await interaction.reply({ content: 'This menu is not for you.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const helpCommand = getHelpCommandModule();
                if (typeof helpCommand?.buildHelpEmbed !== 'function' || typeof helpCommand?.buildHelpComponents !== 'function') {
                    try { await interaction.reply({ content: 'Help menu is unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const selectedCategory = interaction.values?.[0] || null;
                    const embed = helpCommand.buildHelpEmbed(selectedCategory, interaction.guildId, interaction.client.user);
                    const components = helpCommand.buildHelpComponents(selectedCategory, ownerId || interaction.user.id);
                    await interaction.update({ embeds: [embed], components });
                } catch (err) {
                    console.error('Failed to update help view via select menu:', err);
                    try { await interaction.reply({ content: 'Failed to update help. Please try again.', ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId === 'botconfig:category') {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'Manage Server permission is required to configure the bot.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const utilEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'utility', true);
                try {
                    const selectedCategory = interaction.values?.[0] || null;
                    const view = await botConfigView.buildBotConfigView(interaction.guild, selectedCategory);
                    await interaction.update({ embeds: [view.embed], components: view.components });
                } catch (err) {
                    console.error('Failed to update bot config view via select menu:', err);
                    try { await interaction.followUp({ content: 'Failed to update bot configuration. Please try again.', ephemeral: utilEphemeral }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId === 'logconfig:category') {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                    try { await interaction.reply({ content: 'Administrator permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const selectedCategory = interaction.values?.[0];
                    const view = await logConfigView.buildLogConfigView(interaction.guild, null, { category: selectedCategory, page: 0 });
                    await interaction.update({ embeds: [view.embed], components: view.components });
                } catch (err) {
                    console.error('Failed to update log configuration view:', err);
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('logconfig:event:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                    try { await interaction.reply({ content: 'Administrator permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const selectedKey = interaction.values?.[0];
                    const category = interaction.customId.slice('logconfig:event:'.length) || null;
                    const view = await logConfigView.buildLogConfigView(
                        interaction.guild,
                        selectedKey,
                        category ? { category } : {},
                    );
                    await interaction.update({ embeds: [view.embed], components: view.components });
                } catch (err) {
                    console.error('Failed to update log configuration view:', err);
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('antinuke:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'You need Manage Server to update anti-nuke settings.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const previousConfig = await antiNukeManager.getConfig(interaction.guildId);
                    let updatedConfig = null;
                    if (interaction.customId === 'antinuke:flags') {
                        updatedConfig = await antiNukeManager.updateFlags(interaction.guildId, interaction.values);
                    } else if (interaction.customId === 'antinuke:threshold:channelDelete') {
                        const value = interaction.values?.[0];
                        updatedConfig = await antiNukeManager.updateThreshold(interaction.guildId, 'channelDelete', value);
                    } else if (interaction.customId === 'antinuke:threshold:roleDelete') {
                        const value = interaction.values?.[0];
                        updatedConfig = await antiNukeManager.updateThreshold(interaction.guildId, 'roleDelete', value);
                    } else {
                        return;
                    }
                    const view = await antiNukeManager.buildConfigView(interaction.guild, updatedConfig);
                    await interaction.update({ embeds: [view.embed], components: view.components });
                    await logAntiNukeConfigChange(interaction, previousConfig, updatedConfig);
                } catch (err) {
                    console.error('Failed to update anti-nuke configuration via select menu:', err);
                    const content = 'Failed to update anti-nuke settings. Please try again.';
                    try {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({ content, ephemeral: true });
                        } else {
                            await interaction.reply({ content, ephemeral: true });
                        }
                    } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('rr:mine:select:')) {
                if (!interaction.inGuild()) return;
                const parts = interaction.customId.split(':');
                const panelId = parts[3];
                if (!panelId) return;

                const panel = reactionRoleStore.getPanel(interaction.guildId, panelId);
                if (!panel) {
                    try { await interaction.reply({ content: 'This reaction role panel is no longer available.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const me = interaction.guild.members.me;
                if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
                    try { await interaction.reply({ content: 'I am missing Manage Roles to update your roles.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let member = null;
                try { member = await interaction.guild.members.fetch(interaction.user.id); } catch (_) {}
                if (!member) {
                    try { await interaction.reply({ content: 'Could not load your member data.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try { await interaction.deferUpdate(); } catch (_) {}

                const panelRoleIds = Array.isArray(panel.roleIds) ? panel.roleIds : [];
                const selectedRaw = Array.isArray(interaction.values) ? interaction.values : [];
                const selectedSet = new Set(selectedRaw.filter(id => id !== 'none' && panelRoleIds.includes(id)));
                const ownedSet = new Set(panelRoleIds.filter(id => member.roles.cache.has(id)));

                let toAdd = panelRoleIds.filter(id => selectedSet.has(id) && !ownedSet.has(id));
                let toRemove = panelRoleIds.filter(id => ownedSet.has(id) && !selectedSet.has(id));

                const blockedAdd = [];
                const blockedRemove = [];
                const canManage = (roleId) => {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (!role || role.managed) return false;
                    return me.roles.highest.comparePositionTo(role) > 0;
                };

                toAdd = toAdd.filter(id => {
                    if (!canManage(id)) {
                        blockedAdd.push(id);
                        return false;
                    }
                    return true;
                });
                toRemove = toRemove.filter(id => {
                    if (!canManage(id)) {
                        blockedRemove.push(id);
                        return false;
                    }
                    return true;
                });

                let updateError = null;
                try {
                    if (toRemove.length) await member.roles.remove(toRemove, 'Reaction role selection');
                    if (toAdd.length) await member.roles.add(toAdd, 'Reaction role selection');
                } catch (err) {
                    console.error('Failed to update reaction roles:', err);
                    updateError = 'Failed to update your roles. Please try again.';
                }

                let finalRoleSet = new Set(member.roles.cache.keys());
                if (updateError) {
                    try {
                        const fresh = await interaction.guild.members.fetch(interaction.user.id);
                        finalRoleSet = new Set(fresh.roles.cache.keys());
                    } catch (_) {}
                } else {
                    for (const id of toAdd) finalRoleSet.add(id);
                    for (const id of toRemove) finalRoleSet.delete(id);
                }
                const personalRoles = panelRoleIds.filter(id => finalRoleSet.has(id));

                try {
                    const panelChannel = await interaction.guild.channels.fetch(panel.channelId);
                    if (panelChannel?.isTextBased?.()) {
                        const panelMessage = await panelChannel.messages.fetch(panel.messageId);
                        if (panelMessage?.editable) {
                            const view = reactionRoleManager.buildMenuRow(panel, interaction.guild);
                            const mergedMenu = reactionRoleManager.upsertMenuRow(panelMessage.components, view.customId, view.row);
                            const mine = reactionRoleManager.buildMySelectionsRow(panel);
                            const merged = mergedMenu.ok
                                ? reactionRoleManager.upsertMenuRow(mergedMenu.rows, mine.customId, mine.row)
                                : mergedMenu;
                            const editPayload = {};
                            if (merged.ok) editPayload.components = merged.rows;

                            const roleCounts = await reactionRoleManager.fetchPanelRoleCounts(interaction.guild, panel);
                            const summary = reactionRoleManager.buildSummaryEmbed(panel, interaction.guild, { roleCounts });
                            const summaryResult = reactionRoleManager.mergeSummaryEmbed(panelMessage.embeds, summary.embed, panel);
                            if (summaryResult.ok) editPayload.embeds = summaryResult.embeds;

                            if (Object.keys(editPayload).length) {
                                try { await panelMessage.edit(editPayload); } catch (_) {}
                            }
                        }
                    }
                } catch (_) {}

                const notes = [];
                if (updateError) notes.push(updateError);
                if (blockedAdd.length) notes.push('Some selected roles could not be added due to role hierarchy.');
                if (blockedRemove.length) notes.push('Some selected roles could not be removed due to role hierarchy.');

                const selectionLine = personalRoles.length
                    ? `You have selected: ${personalRoles.map(id => `<@&${id}>`).join(', ')}.`
                    : 'You have selected: none.';
                try {
                    await interaction.followUp({
                        content: notes.length ? `${selectionLine} ${notes.join(' ')}` : selectionLine,
                        ephemeral: true,
                    });
                } catch (_) {}
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('rr:select:')) {
                if (!interaction.inGuild()) return;
                const parts = interaction.customId.split(':');
                const panelId = parts[2];
                if (!panelId) return;

                const panel = reactionRoleStore.getPanel(interaction.guildId, panelId);
                if (!panel) {
                    try { await interaction.reply({ content: 'This reaction role panel is no longer available.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const me = interaction.guild.members.me;
                if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
                    try { await interaction.reply({ content: 'I am missing Manage Roles to update your roles.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let member = null;
                try { member = await interaction.guild.members.fetch(interaction.user.id); } catch (_) {}
                if (!member) {
                    try { await interaction.reply({ content: 'Could not load your member data.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try { await interaction.deferUpdate(); } catch (_) {}

                const panelRoleIds = Array.isArray(panel.roleIds) ? panel.roleIds : [];
                const selectedRaw = Array.isArray(interaction.values) ? interaction.values : [];
                const selected = selectedRaw.filter(id => id !== 'none' && panelRoleIds.includes(id));

                let toAdd = [];
                let toRemove = [];

                if (panel.multi) {
                    for (const id of selected) {
                        if (member.roles.cache.has(id)) toRemove.push(id);
                        else toAdd.push(id);
                    }
                } else {
                    const selectedId = selected[0] || null;
                    if (!selectedId) {
                        toRemove = panelRoleIds.filter(id => member.roles.cache.has(id));
                    } else if (member.roles.cache.has(selectedId)) {
                        toRemove = [selectedId];
                    } else {
                        toAdd = [selectedId];
                        toRemove = panelRoleIds.filter(id => id !== selectedId && member.roles.cache.has(id));
                    }
                }

                const blockedAdd = [];
                const blockedRemove = [];
                const canManage = (roleId) => {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (!role || role.managed) return false;
                    return me.roles.highest.comparePositionTo(role) > 0;
                };

                toAdd = toAdd.filter(id => {
                    if (!canManage(id)) {
                        blockedAdd.push(id);
                        return false;
                    }
                    return true;
                });
                toRemove = toRemove.filter(id => {
                    if (!canManage(id)) {
                        blockedRemove.push(id);
                        return false;
                    }
                    return true;
                });

                let updateError = null;
                try {
                    if (toRemove.length) await member.roles.remove(toRemove, 'Reaction role selection');
                    if (toAdd.length) await member.roles.add(toAdd, 'Reaction role selection');
                } catch (err) {
                    console.error('Failed to update reaction roles:', err);
                    updateError = 'Failed to update your roles. Please try again.';
                }

                const view = reactionRoleManager.buildMenuRow(panel, interaction.guild);
                const mergedMenu = reactionRoleManager.upsertMenuRow(interaction.message.components, view.customId, view.row);
                const mine = reactionRoleManager.buildMySelectionsRow(panel);
                const merged = mergedMenu.ok
                    ? reactionRoleManager.upsertMenuRow(mergedMenu.rows, mine.customId, mine.row)
                    : mergedMenu;

                const editPayload = {};
                if (merged.ok) editPayload.components = merged.rows;

                const notes = [];
                if (updateError) notes.push(updateError);
                if (blockedAdd.length) notes.push('Some selected roles could not be added due to role hierarchy.');
                if (blockedRemove.length) notes.push('Some selected roles could not be removed due to role hierarchy.');

                let finalRoleSet = new Set(member.roles.cache.keys());
                if (updateError) {
                    try {
                        const fresh = await interaction.guild.members.fetch(interaction.user.id);
                        finalRoleSet = new Set(fresh.roles.cache.keys());
                    } catch (_) {}
                } else {
                    for (const id of toAdd) finalRoleSet.add(id);
                    for (const id of toRemove) finalRoleSet.delete(id);
                }
                const personalRoles = panelRoleIds.filter(id => finalRoleSet.has(id));
                const roleCounts = await reactionRoleManager.fetchPanelRoleCounts(interaction.guild, panel);
                const summary = reactionRoleManager.buildSummaryEmbed(panel, interaction.guild, { roleCounts });
                const summaryResult = reactionRoleManager.mergeSummaryEmbed(interaction.message.embeds, summary.embed, panel);
                if (summaryResult.ok) {
                    editPayload.embeds = summaryResult.embeds;
                }

                if (Object.keys(editPayload).length) {
                    try { await interaction.message.edit(editPayload); } catch (_) {}
                }

                const selectionLine = personalRoles.length
                    ? `You have selected: ${personalRoles.map(id => `<@&${id}>`).join(', ')}.`
                    : 'You have selected: none.';
                const followUpPayload = {
                    content: notes.length ? `${selectionLine} ${notes.join(' ')}` : selectionLine,
                    ephemeral: true,
                };
                // No summary embed; just a silent ephemeral text follow-up.

                try { await interaction.followUp(followUpPayload); } catch (_) {}
                return;
            }
        }

        if (interaction.isChannelSelectMenu()) {
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('logconfig:setgroupchannel:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                    try { await interaction.reply({ content: 'Administrator permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const logEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'logging', true);
                const groupId = interaction.customId.slice('logconfig:setgroupchannel:'.length);
                const channelId = interaction.values?.[0];
                if (!groupId || !channelId) return;
                try {
                    const group = logConfigView.getLogGroupById(groupId);
                    if (!group?.keys?.length) return;
                    await Promise.all(group.keys.map(key => logChannelTypeStore.setChannel(interaction.guildId, key, channelId)));
                    const view = await logConfigView.buildLogConfigView(interaction.guild, null, { category: groupId });
                    await interaction.update({ embeds: [view.embed], components: view.components });
                    try { await interaction.followUp({ content: `Set all ${group.label} events to <#${channelId}>.`, ephemeral: logEphemeral }); } catch (_) {}
                } catch (err) {
                    console.error('Failed to apply group log channel:', err);
                    try { await interaction.followUp({ content: 'Failed to set the group log channel. Please try again.', ephemeral: logEphemeral }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('logconfig:setchannel:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                    try { await interaction.reply({ content: 'Administrator permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const logEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'logging', true);
                const payload = interaction.customId.slice('logconfig:setchannel:'.length);
                if (!payload) return;
                const payloadParts = payload.split(':');
                const hasCategory = payloadParts.length >= 2;
                const category = hasCategory ? payloadParts[0] : null;
                const logType = hasCategory ? payloadParts.slice(1).join(':') : payloadParts[0];
                if (!logType || logType === 'none') return;
                const channelId = interaction.values?.[0];
                if (!channelId) return;
                try {
                    await logChannelTypeStore.setChannel(interaction.guildId, logType, channelId);
                    const view = await logConfigView.buildLogConfigView(
                        interaction.guild,
                        logType,
                        category ? { category } : {},
                    );
                    await interaction.update({ embeds: [view.embed], components: view.components });
                    const friendly = logConfigManager.getFriendlyName(logType);
                    try { await interaction.followUp({ content: `Set ${friendly} logs to <#${channelId}>.`, ephemeral: logEphemeral }); } catch (_) {}
                } catch (err) {
                    console.error('Failed to update log configuration via channel select:', err);
                    try { await interaction.followUp({ content: 'Failed to assign the selected channel. Please try again.', ephemeral: logEphemeral }); } catch (_) {}
                }
                return;
            }
        }

        if (interaction.isUserSelectMenu()) {
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('store:')) {
                const storeConfigCommand = getStoreConfigCommandModule();
                if (typeof storeConfigCommand?.handleStoreUserSelect !== 'function') {
                    try { await interaction.reply({ content: 'Store tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await storeConfigCommand.handleStoreUserSelect(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle store user select:', err);
                    try { await interaction.reply({ content: 'Store action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('sacrifice:nominate:')) {
                if (!interaction.inGuild()) return;

                const channelId = interaction.customId.slice('sacrifice:nominate:'.length);
                const targetId = interaction.values?.[0];

                if (!targetId) {
                    try { await interaction.reply({ content: 'Please select a valid user.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let channel = null;
                try { channel = await interaction.guild.channels.fetch(channelId); } catch (_) {}
                if (!channel || !channel.isTextBased?.()) {
                    try { await interaction.reply({ content: 'That sacrifice panel is no longer available.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let targetMember = null;
                try { targetMember = await interaction.guild.members.fetch(targetId); } catch (_) {}
                if (!targetMember) {
                    try { await interaction.reply({ content: 'That user is no longer in this server.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let usage = null;
                const isBotOwner = isOwner(interaction.user.id);
                try {
                    usage = await sacrificeNominationStore.consumeNomination(
                        interaction.guildId,
                        interaction.user.id,
                        targetMember.id,
                        Date.now(),
                        { bypassCooldown: isBotOwner },
                    );
                } catch (err) {
                    console.error('Failed to check sacrifice nomination usage:', err);
                    try { await interaction.reply({ content: 'Could not process your nomination right now. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }

                if (!usage?.allowed) {
                    const retryAfter = formatSacrificeCooldown(usage?.retryAfterMs);
                    try { await interaction.reply({ content: `You have no nominations left right now. You can vote again in ${retryAfter}.`, ephemeral: true }); } catch (_) {}
                    return;
                }

                let acknowledged = false;
                try {
                    await interaction.deferUpdate();
                    acknowledged = true;
                } catch (_) {}

                const embed = new EmbedBuilder()
                    .setTitle('Communal Sacrifice')
                    .setDescription(
                        `${targetMember} (${targetMember.user.username}) has been voted to be tribute for the communal sacrifice.` +
                        (usage.targetNominationCount > 1 ? `\nThey now have (${usage.targetNominationCount}) nominations.` : '')
                    )
                    .setThumbnail(targetMember.displayAvatarURL({ extension: 'png', size: 256 }))
                    .setTimestamp();

                try {
                    const { applyDefaultColour } = require('../utils/guildColourStore');
                    applyDefaultColour(embed, interaction.guildId);
                } catch (_) {}

                try {
                    await channel.send({
                        embeds: [embed],
                        components: [buildSacrificeNominationRow(channel.id)],
                        allowedMentions: { parse: [] },
                    });
                } catch (_) {
                    try { await sacrificeNominationStore.rollbackLastNomination(interaction.guildId, usage.rollbackToken); } catch (_) {}
                    const failPayload = { content: 'Failed to post the sacrifice nomination. Please try again.', ephemeral: true };
                    try {
                        if (acknowledged) await interaction.followUp(failPayload);
                        else await interaction.reply(failPayload);
                    } catch (_) {}
                    return;
                }

                try {
                    await rupeeStore.addTokens(interaction.guildId, interaction.user.id, 1);
                } catch (err) {
                    console.error('Failed to grant sacrifice vote rupee:', err);
                }

                const successPayload = {
                    content: isBotOwner
                        ? `Thank you for your vote. You have been given ${formatCurrencyAmount(interaction.guildId, 1)}. Bot owner votes are unlimited.`
                        : `Thank you for your vote. You have been given ${formatCurrencyAmount(interaction.guildId, 1)}. Come back in 24 hours to vote again.`,
                    ephemeral: true,
                };
                try {
                    if (acknowledged) await interaction.followUp(successPayload);
                    else await interaction.reply(successPayload);
                } catch (_) {}
                return;
            }
        }

        // Handle Verify button
        if (interaction.isButton()) {
            if (typeof interaction.customId === 'string' && interaction.customId === botSettingsView.BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR_ID) {
                if (!interaction.inGuild()) return;
                if (!canManageBotSettings(interaction)) {
                    try { await interaction.reply({ content: 'Administrator or server owner access is required to edit bot settings.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const modal = botSettingsView.buildEmbedColourModal(interaction.guildId);
                    await interaction.showModal(modal);
                } catch (err) {
                    console.error('Failed to open bot settings colour modal:', err);
                    try { await interaction.reply({ content: 'Failed to open the colour modal. Please try again.', ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId === botSettingsView.BOTSETTINGS_ACTION_REFRESH_ID) {
                if (!interaction.inGuild()) return;
                if (!canManageBotSettings(interaction)) {
                    try { await interaction.reply({ content: 'Administrator or server owner access is required to edit bot settings.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const view = botSettingsView.buildBotSettingsView(interaction.guild);
                    await interaction.update({ embeds: [view.embed], components: view.components });
                } catch (err) {
                    console.error('Failed to refresh bot settings view:', err);
                    try { await interaction.reply({ content: 'Failed to refresh bot settings. Please try again.', ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('store:')) {
                const storeConfigCommand = getStoreConfigCommandModule();
                if (typeof storeConfigCommand?.handleStoreButton !== 'function') {
                    try { await interaction.reply({ content: 'Store tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await storeConfigCommand.handleStoreButton(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle store button:', err);
                    try { await interaction.reply({ content: 'Store action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('autorespond:list:')) {
                const autorespondCommand = getAutorespondCommandModule();
                if (typeof autorespondCommand?.handleButton !== 'function') {
                    try { await interaction.reply({ content: 'Autorespond tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await autorespondCommand.handleButton(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle autorespond button:', err);
                    try { await interaction.reply({ content: 'Autorespond action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('rr:mine:')) {
                if (!interaction.inGuild()) return;
                const parts = interaction.customId.split(':');
                const panelId = parts[2];
                if (!panelId) return;

                const panel = reactionRoleStore.getPanel(interaction.guildId, panelId);
                if (!panel) {
                    try { await interaction.reply({ content: 'This reaction role panel is no longer available.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let member = null;
                try { member = await interaction.guild.members.fetch(interaction.user.id); } catch (_) {}
                if (!member) {
                    try { await interaction.reply({ content: 'Could not load your member data.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const panelRoleIds = Array.isArray(panel.roleIds) ? panel.roleIds : [];
                const personalRoles = panelRoleIds.filter(id => member.roles.cache.has(id));
                const personalMenu = reactionRoleManager.buildPersonalMenuRow(panel, interaction.guild, personalRoles);
                const selectionLine = personalRoles.length
                    ? `Current selections: ${personalRoles.map(id => `<@&${id}>`).join(', ')}.`
                    : 'Current selections: none.';

                try {
                    await interaction.reply({
                        content: `${selectionLine}\nUse the menu below to update your roles.`,
                        components: [personalMenu.row],
                        ephemeral: true,
                    });
                } catch (_) {}
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('botconfig:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'Manage Server permission is required to configure the bot.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const utilEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'utility', true);
                const [, action, categoryKeyRaw] = interaction.customId.split(':');
                const categoryKey = categoryKeyRaw && categoryKeyRaw !== 'none' ? categoryKeyRaw : null;
                try {
                    let view = null;
                    if (action === 'toggleEnabled' && categoryKey) {
                        view = await botConfigView.handleToggleEnabled(interaction, categoryKey);
                    } else if (action === 'toggleReplies' && categoryKey) {
                        view = await botConfigView.handleToggleReplies(interaction, categoryKey);
                    } else if (action === 'reset') {
                        view = await botConfigView.handleReset(interaction, categoryKey);
                    } else {
                        return;
                    }
                    await interaction.update({ embeds: [view.embed], components: view.components });
                } catch (err) {
                    console.error('Failed to update bot configuration via button:', err);
                    try { await interaction.followUp({ content: 'Failed to update bot configuration. Please try again.', ephemeral: utilEphemeral }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('logconfig:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                    try { await interaction.reply({ content: 'Administrator permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const logEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'logging', true);
                const [, action, logType, actionValue] = interaction.customId.split(':');
                if (!logType) return;
                let followUpContent = null;
                let handledError = false;
                try {
                    if (action === 'page') {
                        const [, , category, pageRaw, selectedRaw] = interaction.customId.split(':');
                        const page = Number(pageRaw);
                        const selectedKey = selectedRaw && selectedRaw !== 'none' ? selectedRaw : null;
                        const view = await logConfigView.buildLogConfigView(interaction.guild, selectedKey, { category, page });
                        await interaction.update({ embeds: [view.embed], components: view.components });
                        return;
                    } else if (action === 'toggle') {
                        const entry = await logChannelTypeStore.getEntry(interaction.guildId, logType);
                        if (entry) {
                            await logChannelTypeStore.setEnabled(interaction.guildId, logType, !entry.enabled);
                        }
                    } else if (action === 'setenabled') {
                        const desiredEnabled = actionValue === '1' || String(actionValue).toLowerCase() === 'true';
                        await logChannelTypeStore.setEnabled(interaction.guildId, logType, desiredEnabled);
                    } else if (action === 'default') {
                        followUpContent = 'Automatic channel creation is disabled. Please pick an existing channel from the selector.';
                    } else {
                        return;
                    }
                    const view = await logConfigView.buildLogConfigView(interaction.guild, logType);
                    await interaction.update({ embeds: [view.embed], components: view.components });
                } catch (err) {
                    handledError = true;
                    console.error('Failed to update log configuration via button:', err);
                    try { await interaction.followUp({ content: 'Failed to update logging configuration. Please try again later.', ephemeral: logEphemeral }); } catch (_) {}
                }
                if (!handledError && followUpContent) {
                    try { await interaction.followUp({ content: followUpContent, ephemeral: logEphemeral }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('roleclean:')) {
                if (!interaction.inGuild()) return;
                try {
                    await roleCleanManager.handleRoleCleanButton(interaction);
                } catch (err) {
                    console.error('Failed to handle roleclean button:', err);
                }
                return;
            }
            if (interaction.customId === 'brconfig:open') {
                if (!interaction.inGuild()) return;

                const enabled = await boosterConfigStore.isEnabled(interaction.guildId);
                if (!enabled) {
                    try { await interaction.reply({ content: 'Custom booster roles are disabled on this server.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let member = interaction.member;
                if (!member?.roles?.cache) {
                    member = await fetchMember(interaction.guild, interaction.user.id);
                }
                if (!member) {
                    try { await interaction.reply({ content: 'Could not fetch your member data.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const premiumRoleId = interaction.guild.roles.premiumSubscriberRole?.id || null;
                if (!isActiveBooster(member, premiumRoleId)) {
                    try { await interaction.reply({ content: 'This panel is for active server boosters only.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const modal = new ModalBuilder()
                    .setCustomId(`brconfig:modal:${interaction.user.id}`)
                    .setTitle('Booster Role Configuration');
                const nameInput = new TextInputBuilder()
                    .setCustomId('brconfig:role_name')
                    .setLabel('Role Name')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(100)
                    .setRequired(true);
                const primaryInput = new TextInputBuilder()
                    .setCustomId('brconfig:primary')
                    .setLabel('Primary Colour')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('#ff0000')
                    .setMinLength(6)
                    .setMaxLength(7)
                    .setRequired(true);
                const secondaryInput = new TextInputBuilder()
                    .setCustomId('brconfig:secondary')
                    .setLabel('Secondary Colour (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('#00ff00')
                    .setMaxLength(7)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(nameInput),
                    new ActionRowBuilder().addComponents(primaryInput),
                    new ActionRowBuilder().addComponents(secondaryInput),
                );

                try {
                    await interaction.showModal(modal);
                } catch (_) {
                    try { await interaction.reply({ content: 'Could not open the booster role form. Please try again.', ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('suggest:open:')) {
                if (!interaction.inGuild()) return;

                const channelId = interaction.customId.slice('suggest:open:'.length);
                let channel = null;
                try { channel = await interaction.guild.channels.fetch(channelId); } catch (_) {}
                if (!channel || !channel.isTextBased?.()) {
                    try { await interaction.reply({ content: 'That suggestion panel is no longer available.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const modal = new ModalBuilder()
                    .setCustomId(`suggest:submit:${channelId}`)
                    .setTitle('Share a Suggestion');
                const suggestionInput = new TextInputBuilder()
                    .setCustomId('suggest:suggestion')
                    .setLabel('Suggestion')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(1)
                    .setMaxLength(1000)
                    .setPlaceholder('What would you like to see improved or added?')
                    .setRequired(true);
                const reasoningInput = new TextInputBuilder()
                    .setCustomId('suggest:reasoning')
                    .setLabel('Reasoning / Context')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(1)
                    .setMaxLength(1000)
                    .setPlaceholder('Why would this change help or matter?')
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(suggestionInput),
                    new ActionRowBuilder().addComponents(reasoningInput),
                );

                try {
                    await interaction.showModal(modal);
                } catch (_) {
                    try { await interaction.reply({ content: 'Could not open the suggestion form. Please try again.', ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('confess:open:')) {
                if (!interaction.inGuild()) return;

                const channelId = interaction.customId.slice('confess:open:'.length);
                let channel = null;
                try { channel = await interaction.guild.channels.fetch(channelId); } catch (_) {}
                if (!channel || !channel.isTextBased?.()) {
                    try { await interaction.reply({ content: 'That confession panel is no longer available.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const modal = new ModalBuilder()
                    .setCustomId(`confess:submit:${channelId}`)
                    .setTitle('Anonymous Confession');
                const input = new TextInputBuilder()
                    .setCustomId('confess:text')
                    .setLabel('Write an anonymous confession')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(1)
                    .setMaxLength(1000)
                    .setPlaceholder('Write an anonymous confession')
                    .setRequired(true);
                const row = new ActionRowBuilder().addComponents(input);
                modal.addComponents(row);

                try {
                    await interaction.showModal(modal);
                } catch (_) {
                    try { await interaction.reply({ content: 'Could not open the confession form. Please try again.', ephemeral: true }); } catch (_) {}
                }
                return;
            }
        }

        // Handle modal submissions
        if (interaction.isModalSubmit()) {
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('autorespond:list:editmodal:')) {
                const autorespondCommand = getAutorespondCommandModule();
                if (typeof autorespondCommand?.handleModalSubmit !== 'function') {
                    try { await interaction.reply({ content: 'Autorespond tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await autorespondCommand.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle autorespond modal submit:', err);
                    try { await interaction.reply({ content: 'Autorespond action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('store:')) {
                const storeConfigCommand = getStoreConfigCommandModule();
                if (typeof storeConfigCommand?.handleStoreModalSubmit !== 'function') {
                    try { await interaction.reply({ content: 'Store tools are unavailable right now. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const handled = await storeConfigCommand.handleStoreModalSubmit(interaction);
                    if (handled) return;
                } catch (err) {
                    console.error('Failed to handle store modal submit:', err);
                    try { await interaction.reply({ content: 'Store action failed. Please try again.', ephemeral: true }); } catch (_) {}
                    return;
                }
            }
            if (typeof interaction.customId === 'string' && interaction.customId === botSettingsView.BOTSETTINGS_COLOUR_MODAL_ID) {
                if (!interaction.inGuild()) return;
                if (!canManageBotSettings(interaction)) {
                    try { await interaction.reply({ content: 'Administrator or server owner access is required to edit bot settings.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const rawColour = (interaction.fields.getTextInputValue(botSettingsView.BOTSETTINGS_COLOUR_INPUT_ID) || '').trim();
                if (!rawColour) {
                    try { await interaction.reply({ content: 'Please enter a colour value, or type `reset`.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const parsed = await setDefaultColour(interaction.guildId, rawColour);
                    const view = botSettingsView.buildBotSettingsView(interaction.guild);
                    const message = parsed === null
                        ? 'Embed colour reset to bot default for this server.'
                        : `Embed colour updated for this server: ${toHex6(parsed)}.`;
                    await interaction.reply({
                        content: message,
                        embeds: [view.embed],
                        components: view.components,
                        ephemeral: true,
                    });
                } catch (err) {
                    try { await interaction.reply({ content: `Failed to update embed colour: ${err.message}`, ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('vanityrole:modal:')) {
                if (!interaction.inGuild()) return;

                const parts = interaction.customId.split(':');
                const ownerId = parts[2];
                const roleId = parts[3] || null;
                if (ownerId && interaction.user.id !== ownerId) {
                    try { await interaction.reply({ content: 'This vanity role form is not for you.', ephemeral: true }); } catch (_) {}
                    return;
                }
                if (!roleId) {
                    try { await interaction.reply({ content: 'This vanity role form is missing a role. Run `/vanityrole setup` again.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try { await interaction.deferReply({ ephemeral: true }); } catch (_) {}

                try {
                    const vanityRoleCommand = getVanityRoleCommandModule();
                    if (typeof vanityRoleCommand?.handleVanityRoleModalSubmit === 'function') {
                        await vanityRoleCommand.handleVanityRoleModalSubmit(interaction, roleId);
                    } else {
                        await interaction.editReply({ content: 'Vanity role setup is unavailable right now.' });
                    }
                } catch (err) {
                    console.error('Vanity role modal submit failed:', err);
                    try { await interaction.editReply({ content: 'Failed to update your vanity role. Please try again.' }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('brconfig:modal:')) {
                if (!interaction.inGuild()) return;

                const parts = interaction.customId.split(':');
                const ownerId = parts[2];
                if (ownerId && interaction.user.id !== ownerId) {
                    try { await interaction.reply({ content: 'This booster role form is not for you.', ephemeral: true }); } catch (_) {}
                    return;
                }

                await interaction.deferReply({ ephemeral: true });

                const enabled = await boosterConfigStore.isEnabled(interaction.guildId);
                if (!enabled) {
                    await interaction.editReply({ content: 'Custom booster roles are disabled on this server.' });
                    return;
                }

                let member = interaction.member;
                if (!member?.roles?.cache) {
                    member = await fetchMember(interaction.guild, interaction.user.id);
                }
                if (!member) {
                    await interaction.editReply({ content: 'Could not fetch your member data.' });
                    return;
                }

                const premiumRoleId = interaction.guild.roles.premiumSubscriberRole?.id || null;
                if (!isActiveBooster(member, premiumRoleId)) {
                    await interaction.editReply({ content: 'You need an active server boost to configure a booster role.' });
                    return;
                }

                const roleName = (interaction.fields.getTextInputValue('brconfig:role_name') || '').trim();
                const primaryRaw = (interaction.fields.getTextInputValue('brconfig:primary') || '').trim();
                const secondaryRaw = (interaction.fields.getTextInputValue('brconfig:secondary') || '').trim();

                const colorInput = secondaryRaw
                    ? { mode: 'gradient', colors: [primaryRaw, secondaryRaw] }
                    : { mode: 'solid', colors: [primaryRaw] };

                let activeRoleId = null;
                try {
                    const colorResult = await boosterManager.updateRoleColor(member, colorInput);
                    activeRoleId = colorResult?.role?.id || null;
                } catch (err) {
                    await interaction.editReply({
                        content: `Failed to update booster role colours: ${err?.message || 'Unknown error'}`,
                    });
                    return;
                }

                try {
                    const role = await boosterManager.renameRole(member, roleName);
                    if (role?.id) activeRoleId = role.id;
                } catch (err) {
                    await interaction.editReply({
                        content: `Updated colours, but failed to rename the role: ${err?.message || 'Unknown error'}`,
                    });
                    return;
                }

                if (!activeRoleId) {
                    try { activeRoleId = await boosterStore.getRoleId(interaction.guildId, interaction.user.id); } catch (_) {}
                }

                const cleanup = await boosterManager.cleanupLegacyRoles(member, activeRoleId);
                const notes = ['Your booster role has been updated.'];
                if (cleanup.removed > 0) {
                    notes.push(`Removed ${cleanup.removed} legacy booster role${cleanup.removed === 1 ? '' : 's'}.`);
                }
                if (cleanup.deleted > 0) {
                    notes.push(`Deleted ${cleanup.deleted} legacy role${cleanup.deleted === 1 ? '' : 's'}.`);
                }

                await interaction.editReply({ content: notes.join(' ') });
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('confess:submit:')) {
                if (!interaction.inGuild()) return;

                const channelId = interaction.customId.slice('confess:submit:'.length);
                const confession = (interaction.fields.getTextInputValue('confess:text') || '').trim();

                if (!confession) {
                    try { await interaction.reply({ content: 'Please enter a confession before submitting.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let channel = null;
                try { channel = await interaction.guild.channels.fetch(channelId); } catch (_) {}

                if (!channel || !channel.isTextBased?.()) {
                    try { await interaction.reply({ content: 'The confession channel is no longer available. Please inform an admin.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const sanitized = confession
                    .replace(/@/g, '@\u200b')
                    .replace(/#/g, '#\u200b')
                    .replace(/&/g, '&\u200b');

                const embed = new EmbedBuilder()
                    .setTitle('Anonymous Confession')
                    .setDescription(sanitized)
                    .setTimestamp();

                try {
                    const { applyDefaultColour } = require('../utils/guildColourStore');
                    applyDefaultColour(embed, interaction.guildId);
                } catch (_) {}

                const button = new ButtonBuilder()
                    .setCustomId(`confess:open:${channel.id}`)
                    .setLabel('Confess Anonymously')
                    .setStyle(ButtonStyle.Success);
                const buttonRow = new ActionRowBuilder().addComponents(button);

                try {
                    await channel.send({ embeds: [embed], components: [buttonRow] });
                } catch (_) {
                    try { await interaction.reply({ content: 'Failed to send your confession. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try { await interaction.reply({ content: 'Your confession has been sent anonymously.', ephemeral: true }); } catch (_) {}
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('suggest:submit:')) {
                if (!interaction.inGuild()) return;

                const channelId = interaction.customId.slice('suggest:submit:'.length);
                const suggestion = (interaction.fields.getTextInputValue('suggest:suggestion') || '').trim();
                const reasoning = (interaction.fields.getTextInputValue('suggest:reasoning') || '').trim();

                if (!suggestion || !reasoning) {
                    try { await interaction.reply({ content: 'Both suggestion and reasoning are required.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let channel = null;
                try { channel = await interaction.guild.channels.fetch(channelId); } catch (_) {}

                if (!channel || !channel.isTextBased?.()) {
                    try { await interaction.reply({ content: 'The suggestion channel is no longer available. Please inform an admin.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const sanitize = (text) => text
                    .replace(/@/g, '@\u200b')
                    .replace(/#/g, '#\u200b')
                    .replace(/&/g, '&\u200b');

                const embed = new EmbedBuilder()
                    .setTitle('Anonymous Suggestion')
                    .setTimestamp()
                    .addFields(
                        { name: 'Suggestion', value: sanitize(suggestion) },
                        { name: 'Reasoning / Context', value: sanitize(reasoning) },
                    );

                try {
                    const { applyDefaultColour } = require('../utils/guildColourStore');
                    applyDefaultColour(embed, interaction.guildId);
                } catch (_) {}

                const button = new ButtonBuilder()
                    .setCustomId(`suggest:open:${channel.id}`)
                    .setLabel('Share an Anonymous Suggestion')
                    .setStyle(ButtonStyle.Primary);
                const buttonRow = new ActionRowBuilder().addComponents(button);

                try {
                    await channel.send({ embeds: [embed], components: [buttonRow] });
                } catch (_) {
                    try { await interaction.reply({ content: 'Failed to send your suggestion. Please try again later.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try { await interaction.reply({ content: 'Your suggestion has been submitted anonymously.', ephemeral: true }); } catch (_) {}
                return;
            }
            if (interaction.customId === 'embedBuilderModal') {
                await interaction.deferReply({ ephemeral: true });

                const title = interaction.fields.getTextInputValue('embedTitle');
                const description = interaction.fields.getTextInputValue('embedDescription');
                const color = interaction.fields.getTextInputValue('embedColor');
                const image = interaction.fields.getTextInputValue('embedImage');
                const footer = interaction.fields.getTextInputValue('embedFooter');

                try {
                    const { parseColorInput } = require('../utils/colorParser');
                    const sanitiseUrl = (value) => {
                        if (!value) return null;
                        try {
                            const url = new URL(value.trim());
                            if (!['http:', 'https:'].includes(url.protocol)) return null;
                            return url.toString();
                        } catch (_) {
                            return null;
                        }
                    };

                    const embed = new EmbedBuilder()
                        .setColor(parseColorInput(color, 0x5865f2));

                    if (title) embed.setTitle(title.slice(0, 256));
                    if (description) embed.setDescription(description.slice(0, 4096));
                    const safeImage = sanitiseUrl(image);
                    if (safeImage) embed.setImage(safeImage);
                    if (footer) embed.setFooter({ text: footer.slice(0, 2048) });

                    await interaction.editReply({
                        content: '✅ Embed preview generated. Use /embed quick to post it to another channel if needed.',
                        embeds: [embed]
                    });
                } catch (error) {
                    await interaction.editReply({
                        content: '❌ Error creating embed. Please check your inputs (especially image URL and color format).'
                    });
                }
            }
        }
    },
};
