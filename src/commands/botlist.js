const cmdLogger = require('../utils/logger')('botlist');
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, AuditLogEvent } = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const MAX_FIELDS_PER_EMBED = 25;
const MAX_EMBEDS = 10;
const AUDIT_FETCH_LIMIT = 100;

function formatPermissions(permissions) {
    if (!permissions.length) return 'None';
    const display = permissions.slice(0, 6);
    const extra = permissions.length - display.length;
    return `${display.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`;
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function loadBotAddAuditEntries(guild, botIds) {
    const botAddMap = new Map();
    const pendingIds = new Set(botIds);
    let before;

    while (pendingIds.size) {
        const options = { type: AuditLogEvent.BotAdd, limit: AUDIT_FETCH_LIMIT };
        if (before) {
            options.before = before;
        }

        const auditLogs = await guild.fetchAuditLogs(options);
        const entries = [...auditLogs.entries.values()];
        if (!entries.length) {
            break;
        }

        for (const entry of entries) {
            if (!botAddMap.has(entry.targetId)) {
                botAddMap.set(entry.targetId, entry);
                pendingIds.delete(entry.targetId);
            }
        }

        if (entries.length < AUDIT_FETCH_LIMIT) {
            break;
        }

        before = entries[entries.length - 1]?.id;
        if (!before) {
            break;
        }
    }

    return botAddMap;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botlist')
        .setDescription('Show a breakdown of all bots in the server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
        }

        if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'You need Administrator permissions to use this command.', ephemeral: true });
        }

        await interaction.deferReply();

        const guild = interaction.guild;
        let refreshed = true;
        try {
            await guild.members.fetch();
        } catch (err) {
            refreshed = false;
            cmdLogger.warn('Bot list: failed to refresh member cache', err);
        }

        const botMembers = [...guild.members.cache.values()]
            .filter(member => member.user?.bot)
            .sort((a, b) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0));

        if (!botMembers.length) {
            const embed = new EmbedBuilder()
                .setTitle('Bot List')
                .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
                .setDescription('No bots are currently in this server.')
                .setFooter({ text: `Requested by ${interaction.user.tag}` });
            return interaction.editReply({ embeds: [embed] });
        }

        let auditLogError = false;
        let botAddMap = new Map();

        if (botMembers.length) {
            try {
                const botIds = botMembers.map(member => member.id);
                botAddMap = await loadBotAddAuditEntries(guild, botIds);
            } catch (err) {
                auditLogError = true;
                cmdLogger.warn('Bot list: failed to fetch audit logs', err);
            }
        }

        const fields = botMembers.map((member, index) => {
            const perms = member.permissions?.toArray?.() ?? [];
            const permissionText = formatPermissions(perms);
            const joinedText = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown';
            const logEntry = botAddMap.get(member.id);
            const addedBy = logEntry?.executor ? `${logEntry.executor.tag} (${logEntry.executor.id})` : 'Unknown';
            return {
                name: `${index + 1}. ${member.user.tag}`,
                value: [
                    `ID: ${member.user.id}`,
                    `Permissions: ${permissionText}`,
                    `Joined: ${joinedText}`,
                    `Added by: ${addedBy}`,
                ].join('\n'),
            };
        });

        const fieldChunks = chunkArray(fields, MAX_FIELDS_PER_EMBED);
        const truncated = fieldChunks.length > MAX_EMBEDS;
        const limitedChunks = truncated ? fieldChunks.slice(0, MAX_EMBEDS) : fieldChunks;
        const embeds = limitedChunks.map((chunk, chunkIndex) => {
            const start = chunkIndex * MAX_FIELDS_PER_EMBED + 1;
            const end = Math.min(start + chunk.length - 1, botMembers.length);
            const embed = new EmbedBuilder()
                .setTitle(`Bot List (${start}-${end} of ${botMembers.length})`)
                .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
                .addFields(chunk)
                .setFooter({ text: `Requested by ${interaction.user.tag}` });
            return embed;
        });

        const notes = [];
        if (!refreshed) {
            notes.push('Member cache refresh failed; list may be incomplete.');
        }
        if (auditLogError) {
            notes.push('Could not read audit logs; "Added by" may be unavailable.');
        }
        if (truncated) {
            notes.push(`Output truncated to the first ${MAX_FIELDS_PER_EMBED * MAX_EMBEDS} bots.`);
        }
        if (notes.length) {
            embeds[0].setDescription(notes.join(' | '));
        }

        return interaction.editReply({ embeds });
    },
};

