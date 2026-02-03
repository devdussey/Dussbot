const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../utils/securityLogger');
const store = require('../utils/autorolesStore');

const TARGET_OPTIONS = [
    { name: 'All joins (members + bots)', value: 'all' },
    { name: 'Humans only', value: 'member' },
    { name: 'Bots only', value: 'bot' },
];

const TARGET_LABELS = {
    all: 'all joining members',
    member: 'human members only',
    bot: 'bots only',
};

const TARGET_TITLES = {
    all: 'All joins (members + bots)',
    member: 'Humans only',
    bot: 'Bots only',
};

function formatRoleList(guild, ids) {
    return ids
        .map(id => {
            const role = guild.roles.cache.get(id);
            return role ? `<@&${role.id}>` : `Unknown(${id})`;
        })
        .join(', ');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoroles')
        .setDescription('Configure automatic roles for new members')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Add a role to autoroles')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to auto-assign on join')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('target')
                        .setDescription('Who should receive this autorole (default is every join)')
                        .addChoices(...TARGET_OPTIONS)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove a role from autoroles')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to remove')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('target')
                        .setDescription('Which autorole list to remove from (defaults to shared list)')
                        .addChoices(...TARGET_OPTIONS)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List current autoroles')
        )
        .addSubcommand(sub =>
            sub
                .setName('clear')
                .setDescription('Clear all autoroles')
                .addStringOption(opt =>
                    opt.setName('target')
                        .setDescription('Limit clearing to a specific target list')
                        .addChoices(...TARGET_OPTIONS)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await logger.logPermissionDenied(interaction, 'autoroles', 'Bot missing Manage Roles');
            return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
        }

        // Require user permission as well
        if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
            await logger.logPermissionDenied(interaction, 'autoroles', 'User missing Manage Roles');
            return interaction.reply({ content: 'You need Manage Roles to configure autoroles.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const role = interaction.options.getRole('role', true);
            const target = interaction.options.getString('target') || 'all';
            const targetLabel = TARGET_LABELS[target] || TARGET_LABELS.all;

            // Validate role is assignable by bot
            if (role.managed) {
                await logger.logHierarchyViolation(interaction, 'autoroles add', { tag: role.name, id: role.id }, 'Managed role');
                return interaction.reply({ content: 'That role is managed and cannot be assigned by bots.', ephemeral: true });
            }
            if (me.roles.highest.comparePositionTo(role) <= 0) {
                await logger.logHierarchyViolation(interaction, 'autoroles add', { tag: role.name, id: role.id }, 'Bot role not high enough');
                return interaction.reply({ content: 'My role must be higher than the target role.', ephemeral: true });
            }

            const added = store.addGuildRole(interaction.guild.id, role.id, target);
            return interaction.reply({
                content: added
                    ? `Added <@&${role.id}> to autoroles for ${targetLabel}.`
                    : `<@&${role.id}> is already configured for ${targetLabel}.`,
                ephemeral: true,
            });
        }

        if (sub === 'remove') {
            const role = interaction.options.getRole('role', true);
            const target = interaction.options.getString('target') || 'all';
            const targetLabel = TARGET_LABELS[target] || TARGET_LABELS.all;
            const removed = store.removeGuildRole(interaction.guild.id, role.id, target);
            return interaction.reply({
                content: removed ? `Removed <@&${role.id}> from autoroles for ${targetLabel}.` : `<@&${role.id}> was not configured for ${targetLabel}.`,
                ephemeral: true,
            });
        }

        if (sub === 'list') {
            const allIds = store.getGuildRoles(interaction.guild.id, 'all');
            const humanIds = store.getGuildRoles(interaction.guild.id, 'member');
            const botIds = store.getGuildRoles(interaction.guild.id, 'bot');
            const sections = [];
            if (allIds.length) {
                sections.push(`**${TARGET_TITLES.all}**: ${formatRoleList(interaction.guild, allIds)}`);
            }
            if (humanIds.length) {
                sections.push(`**${TARGET_TITLES.member}**: ${formatRoleList(interaction.guild, humanIds)}`);
            }
            if (botIds.length) {
                sections.push(`**${TARGET_TITLES.bot}**: ${formatRoleList(interaction.guild, botIds)}`);
            }
            if (!sections.length) {
                return interaction.reply({ content: 'No autoroles configured.', ephemeral: true });
            }
            return interaction.reply({ content: `Autoroles:\n${sections.join('\n\n')}`, ephemeral: true });
        }

        if (sub === 'clear') {
            const target = interaction.options.getString('target');
            if (target) {
                store.clearGuildRoles(interaction.guild.id, target);
                const targetLabel = TARGET_LABELS[target] || TARGET_LABELS.all;
                return interaction.reply({ content: `Cleared autoroles configured for ${targetLabel}.`, ephemeral: true });
            }
            store.clearGuildRoles(interaction.guild.id);
            return interaction.reply({ content: 'Cleared all autoroles for this server.', ephemeral: true });
        }

        return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    },
};
