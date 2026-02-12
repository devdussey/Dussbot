const { Events, PermissionsBitField, EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const verifyStore = require('../utils/verificationStore');
const securityLogger = require('../utils/securityLogger');
const verifySession = require('../utils/verificationSession');
const antiNukeManager = require('../utils/antiNukeManager');
const logSender = require('../utils/logSender');
const logChannelTypeStore = require('../utils/logChannelTypeStore');
const logConfigManager = require('../utils/logConfigManager');
const logConfigView = require('../utils/logConfigView');
const botConfigStore = require('../utils/botConfigStore');
const botConfigView = require('../utils/botConfigView');
const modLogStore = require('../utils/modLogStore');
const reactionRoleStore = require('../utils/reactionRoleStore');
const reactionRoleManager = require('../utils/reactionRoleManager');
const boosterManager = require('../utils/boosterRoleManager');
const boosterStore = require('../utils/boosterRoleStore');
const boosterConfigStore = require('../utils/boosterRoleConfigStore');
const vanityRoleCommand = require('../commands/vanityrole');
const roleCleanCommand = require('../commands/roleclean');
const { isOwner } = require('../utils/ownerIds');

const MAX_ERROR_STACK = 3500;

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

const COMMAND_CATEGORY_MAP = {
    // Logging
    dmdiag: 'logging',
    invitelogconfig: 'logging',
    logconfig: 'logging',
    logtree: 'logging',
    memberlogconfig: 'logging',
    messagelogconfig: 'logging',

    // Moderation
    automodconfig: 'moderation',
    ban: 'moderation',
    banlist: 'moderation',
    isolate: 'moderation',
    jail: 'moderation',
    kick: 'moderation',
    mute: 'moderation',
    purge: 'moderation',
    roleclean: 'moderation',
    restrainingorder: 'moderation',

    // AI
    analysis: 'ai',
    chat: 'ai',
    fetchchannel: 'ai',
    fetchmessage: 'ai',
    summarize: 'ai',
    transcribe: 'ai',
    transriptconfig: 'ai',

    // Admin / Owner
    antinuke: 'admin',
    backup: 'admin',
    backupdelete: 'admin',
    backuplist: 'admin',
    backupview: 'admin',
    clone: 'admin',
    embed: 'admin',
    say: 'admin',
    showbans: 'admin',
    vanityrole: 'admin',
    verify: 'admin',
    webhooks: 'admin',
    reactionrole: 'admin',

    // Economy
    giverupee: 'economy',
    inventory: 'economy',
    massblessing: 'economy',
    rupeeconfig: 'economy',
    rupeeboard: 'economy',
    rupeestore: 'economy',
    viewrupees: 'economy',

    // Games
    blessing: 'games',
    horserace: 'games',
    horseracestandings: 'games',
    sentancerush: 'games',
    wordrush: 'games',

    // Automations
    autobump: 'automations',
    automessage: 'automations',
    autorespond: 'automations',
    autoroles: 'automations',

    // Images
    enlarge: 'images',
    removebg: 'images',
};

function getCategoryLabel(key) {
  return botConfigStore.getCategoryDefinition(key)?.label || key || 'This category';
}

const MODERATOR_COMMANDS = new Set(['ban', 'banlist', 'kick', 'jail', 'mute', 'unban', 'unmute']);
const OWNER_COMMANDS = new Set(['wraith']);
const ADMIN_COMMANDS = new Set([
  'analysis',
  'antinuke',
  'autobump',
  'automessage',
  'automodconfig',
  'autoroles',
  'autorespond',
  'backup',
  'backupdelete',
  'backuplist',
  'backupview',
  'blessing',
  'botconfig',
  'botlook',
  'botsettings',
  'brconfig',
  'channel',
  'channelsync',
  'chat',
  'clone',
  'confessconfig',
  'dmdiag',
  'embed',
  'enlarge',
  'fetchchannel',
  'fetchmessage',
  'giverupee',
  'horserace',
  'horseracestandings',
  'inventory',
  'invitelogconfig',
  'isolate',
  'logconfig',
  'logtree',
  'memberlogconfig',
  'messagelogconfig',
  'massblessing',
  'purge',
  'reactionrole',
  'removebg',
  'role',
  'roleclean',
  'rupeeconfig',
  'rupeeboard',
  'say',
  'sentancerush',
  'showbans',
  'summarize',
  'transcribe',
  'transriptconfig',
  'vanityrole',
  'verify',
  'viewrupees',
  'webhooks',
  'wordrush',
]);
const ALWAYS_ENABLED_COMMANDS = new Set([
  'rupeestore',
]);
const MANAGE_GUILD_COMMANDS = new Set([
  'searchword',
]);

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Handle chat input commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                try {
                    const logger = require('../utils/securityLogger');
                    await logger.logMissingCommand(interaction);
                } catch (_) {}
                await logCommandError(
                    interaction,
                    new Error('Command handler missing'),
                    'Slash command was invoked but no matching handler is registered.'
                );
                return;
            }

            const cmdName = interaction.commandName;
            const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
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
                if (!hasModRole && !isAdmin) {
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
                if (!isAdmin) {
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

            try {
                await command.execute(interaction);
                await logCommandUsage(interaction, 'Used', 'Command executed successfully', 0x57f287);
            } catch (error) {
                const code = error?.code || error?.status;
                const msg = (error?.message || '').toLowerCase();
                // Ignore common race/expiry cases to prevent noisy logs and dupes
                if (code === 40060 || code === 10062 || msg.includes('already been acknowledged') || msg.includes('unknown interaction')) {
                    console.warn(`Interaction for /${interaction.commandName} expired or was handled elsewhere (code ${code}).`);
                    return;
                }

                console.error(`Error executing ${interaction.commandName}:`, error);

                const errorMessage = 'There was an error while executing this command!';

                // Try to notify the user via the interaction first (best-effort)
                try {
                    if (interaction.replied) {
                        await interaction.followUp({ content: errorMessage, ephemeral: true });
                    } else if (interaction.deferred) {
                        await interaction.editReply({ content: errorMessage });
                    } else {
                        await interaction.reply({ content: errorMessage, ephemeral: true });
                    }
                } catch (replyError) {
                    const rcode = replyError?.code;
                    console.warn('Failed to send error via interaction API:', rcode, replyError?.message);
                }
                await logCommandUsage(interaction, 'Failed', error?.message || 'Unknown error', 0xed4245);
                await logCommandError(interaction, error, 'Command execution threw an error.');
            }
        }

        // Handle select menus
        if (interaction.isStringSelectMenu()) {
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
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'Manage Server permission is required to configure logs.', ephemeral: true }); } catch (_) {}
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
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'Manage Server permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    const selectedKey = interaction.values?.[0];
                    const view = await logConfigView.buildLogConfigView(interaction.guild, selectedKey);
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
                const merged = reactionRoleManager.upsertMenuRow(interaction.message.components, view.customId, view.row);

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
                const summary = reactionRoleManager.buildSummaryEmbed(panel, interaction.guild, { highlightRoleIds: personalRoles });
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
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('logconfig:setchannel:')) {
                if (!interaction.inGuild()) return;
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'Manage Server permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const logEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'logging', true);
                const [, , logType] = interaction.customId.split(':');
                if (!logType) return;
                const channelId = interaction.values?.[0];
                if (!channelId) return;
                try {
                    await logChannelTypeStore.setChannel(interaction.guildId, logType, channelId);
                    const view = await logConfigView.buildLogConfigView(interaction.guild, logType);
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

        // Handle Verify button
        if (interaction.isButton()) {
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
                if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    try { await interaction.reply({ content: 'Manage Server permission is required to configure logs.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const logEphemeral = botConfigStore.shouldReplyEphemeral(interaction.guildId, 'logging', true);
                const [, action, logType] = interaction.customId.split(':');
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
                    await roleCleanCommand.handleRoleCleanButton(interaction);
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
            if (interaction.customId === 'verify:go') {
                if (!interaction.inGuild()) return;

                const cfg = verifyStore.get(interaction.guild.id);
                if (!cfg) {
                    try { await interaction.reply({ content: 'Verification is not configured on this server.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let role = null;
                try { role = await interaction.guild.roles.fetch(cfg.roleId); } catch (_) {}
                if (!role) {
                    try { await interaction.reply({ content: 'The verification role no longer exists. Please contact an admin.', ephemeral: true }); } catch (_) {}
                    return;
                }

                const me = interaction.guild.members.me;
                if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    try { await interaction.reply({ content: 'I am missing Manage Roles.', ephemeral: true }); } catch (_) {}
                    return;
                }
                if (role.managed || me.roles.highest.comparePositionTo(role) <= 0) {
                    try { await interaction.reply({ content: 'I cannot assign the verification role due to role hierarchy.', ephemeral: true }); } catch (_) {}
                    return;
                }

                let member = null;
                try { member = await interaction.guild.members.fetch(interaction.user.id); } catch (_) {}
                if (!member) {
                    try { await interaction.reply({ content: 'Could not fetch your member data.', ephemeral: true }); } catch (_) {}
                    return;
                }

                // Check account age requirement
                const minDays = Math.max(0, cfg.minAccountAgeDays || 0);
                if (minDays > 0) {
                    const accountAgeMs = Date.now() - interaction.user.createdTimestamp;
                    const acctDays = Math.floor(accountAgeMs / (24 * 60 * 60 * 1000));
                    if (acctDays < minDays) {
                        try {
                            await interaction.reply({ content: `Your account must be at least ${minDays} day(s) old to verify. Current: ${acctDays} day(s).`, ephemeral: true });
                        } catch (_) {}
                        try { await securityLogger.logPermissionDenied(interaction, 'verify', 'Account below minimum age'); } catch (_) {}
                        return;
                    }
                }

                // Already verified
                if (member.roles.cache.has(role.id)) {
                    try { await interaction.reply({ content: 'You are already verified.', ephemeral: true }); } catch (_) {}
                    return;
                }

                // Begin captcha flow via modal
                const code = [...Array(5)].map(() => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
                verifySession.create(interaction.guild.id, interaction.user.id, {
                    code,
                    roleId: role.id,
                    removeRoleId: cfg.removeRoleId || null,
                    minAccountAgeDays: cfg.minAccountAgeDays || 0,
                    ttlMs: 3 * 60 * 1000,
                    attempts: 3,
                });

                const modal = new ModalBuilder()
                    .setCustomId('verify:modal')
                    .setTitle(`Verification • Enter: ${code}`);
                const input = new TextInputBuilder()
                    .setCustomId('verify:answer')
                    .setLabel('Type the code shown in the title')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(code.length)
                    .setMaxLength(code.length)
                    .setRequired(true);
                const row = new ActionRowBuilder().addComponents(input);
                modal.addComponents(row);
                try {
                    await interaction.showModal(modal);
                } catch (_) {
                    try { await interaction.reply({ content: 'Could not open verification challenge. Try again.', ephemeral: true }); } catch (_) {}
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
                    if (typeof vanityRoleCommand.handleVanityRoleModalSubmit === 'function') {
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
            // Welcome embed setup modal
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('welcome:embed:')) {
                if (!interaction.inGuild()) return;
                const parts = interaction.customId.split(':');
                const channelId = parts[2];
                let channel = null;
                try { channel = await interaction.guild.channels.fetch(channelId); } catch (_) {}
                if (!channel) {
                    try { await interaction.reply({ content: 'Saved channel not found. Re-run /welcome setup.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try {
                    const { applyDefaultColour } = require('../utils/guildColourStore');
                    const welcomeStore = require('../utils/welcomeStore');
                    const embed = new EmbedBuilder();
                    const title = interaction.fields.getTextInputValue('embedTitle');
                    const description = interaction.fields.getTextInputValue('embedDescription');
                    const color = interaction.fields.getTextInputValue('embedColor');
                    const image = interaction.fields.getTextInputValue('embedImage');
                    const footer = interaction.fields.getTextInputValue('embedFooter');

                    if (title) embed.setTitle(title);
                    if (description) embed.setDescription(description);
                    if (image) embed.setImage(image);
                    if (footer) embed.setFooter({ text: footer });
                    try { applyDefaultColour(embed, interaction.guildId); } catch (_) {}
                    if (color) { try { embed.setColor(color); } catch (_) {} }

                    // Save configuration
                    welcomeStore.set(interaction.guildId, { channelId, embed: embed.toJSON() });

                    // Preview
                    await channel.send({ content: `Welcome, <@${interaction.user.id}>!`, embeds: [embed] });
                    return interaction.reply({ content: `Welcome message saved for ${channel}.`, ephemeral: true });
                } catch (err) {
                    return interaction.reply({ content: `Failed to save welcome: ${err.message}`, ephemeral: true });
                }
            }
            if (interaction.customId === 'verify:modal') {
                if (!interaction.inGuild()) return;
                const sess = verifySession.get(interaction.guild.id, interaction.user.id);
                if (!sess) {
                    try { await interaction.reply({ content: 'Verification session expired. Press Verify again.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const answer = (interaction.fields.getTextInputValue('verify:answer') || '').trim().toUpperCase();
                const expect = String(sess.code || '').toUpperCase();

                if (answer !== expect) {
                    const after = verifySession.consumeAttempt(interaction.guild.id, interaction.user.id);
                    if (!after || after.attempts <= 0) {
                        try { await interaction.reply({ content: 'Incorrect code. Session ended. Press Verify to try again.', ephemeral: true }); } catch (_) {}
                        return;
                    }
                    try { await interaction.reply({ content: `Incorrect code. Attempts left: ${after.attempts}. Press Verify to try again.`, ephemeral: true }); } catch (_) {}
                    return;
                }

                // Correct answer; proceed to assign role
                verifySession.clear(interaction.guild.id, interaction.user.id);

                let role = null;
                try { role = await interaction.guild.roles.fetch(sess.roleId); } catch (_) {}
                if (!role) {
                    try { await interaction.reply({ content: 'Verification role was removed. Contact an admin.', ephemeral: true }); } catch (_) {}
                    return;
                }
                let member = null;
                try { member = await interaction.guild.members.fetch(interaction.user.id); } catch (_) {}
                if (!member) {
                    try { await interaction.reply({ content: 'Could not fetch your member data.', ephemeral: true }); } catch (_) {}
                    return;
                }
                const me = interaction.guild.members.me;
                if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles) || role.managed || me.roles.highest.comparePositionTo(role) <= 0) {
                    try { await interaction.reply({ content: 'I cannot assign the verification role due to missing permission or role hierarchy.', ephemeral: true }); } catch (_) {}
                    return;
                }
                try {
                    await member.roles.add(role, 'User verified via captcha');
                    if (sess.removeRoleId) {
                        let removeRole = null;
                        try { removeRole = await interaction.guild.roles.fetch(sess.removeRoleId); } catch (_) {}
                        if (removeRole && removeRole.id !== role.id && !removeRole.managed && me.roles.highest.comparePositionTo(removeRole) > 0) {
                            try {
                                await member.roles.remove(removeRole, 'User verified via captcha');
                            } catch (removeErr) {
                                console.warn('Failed to remove configured verification remove-role:', removeErr);
                            }
                        }
                    }
                    try { await interaction.reply({ content: 'Verification passed. Role assigned. Welcome!', ephemeral: true }); } catch (_) {}
                } catch (err) {
                    try { await interaction.reply({ content: `Failed to assign role: ${err.message}`, ephemeral: true }); } catch (_) {}
                }
                return;
            }
            if (typeof interaction.customId === 'string' && interaction.customId.startsWith('wraith:start:')) {
                const parts = interaction.customId.split(':');
                const ownerId = parts[2];
                const targetId = parts[3];
                if (!ownerId || !targetId) return;
                if (interaction.user.id !== ownerId) {
                    try { await interaction.reply({ content: 'This wraith configuration modal is not for you.', ephemeral: true }); } catch (_) {}
                    return;
                }

                try {
                    const wraith = require('../commands/isolate');
                    if (typeof wraith.handleWraithStartModalSubmit === 'function') {
                        await wraith.handleWraithStartModalSubmit(interaction, targetId);
                    }
                } catch (err) {
                    console.error('Wraith modal submit failed:', err);
                    try { await interaction.reply({ content: 'Failed to start wraith. Please try again.', ephemeral: true }); } catch (_) {}
                }
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
