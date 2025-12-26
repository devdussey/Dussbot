const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../utils/securityLogger');
const reactionRoleStore = require('../utils/reactionRoleStore');

const ACTIVE_SETUP = new Map();

function sanitiseUrl(input) {
    if (!input || typeof input !== 'string') return null;
    try {
        const url = new URL(input.trim());
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.toString();
    } catch (_) {
        return null;
    }
}

function parseRoleId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const mentionMatch = raw.match(/^<@&(\d+)>$/);
    if (mentionMatch) return mentionMatch[1];
    const idMatch = raw.match(/^(\d{15,25})$/);
    if (idMatch) return idMatch[1];
    return null;
}

function parseEmoji(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const customMatch = raw.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>$/);
    if (customMatch) {
        return { name: customMatch[1], id: customMatch[2], animated: raw.startsWith('<a:') };
    }
    return raw.slice(0, 50);
}

function parseConfigLines(lines) {
    const config = {
        title: '',
        description: '',
        image: '',
        placeholder: '',
        optionLines: [],
    };

    for (const line of lines) {
        const trimmed = String(line || '').trim();
        if (!trimmed) continue;

        const lower = trimmed.toLowerCase();
        if (lower.startsWith('title:')) {
            config.title = trimmed.slice('title:'.length).trim();
            continue;
        }
        if (lower.startsWith('description:')) {
            config.description = trimmed.slice('description:'.length).trim();
            continue;
        }
        if (lower.startsWith('desc:')) {
            config.description = trimmed.slice('desc:'.length).trim();
            continue;
        }
        if (lower.startsWith('image:')) {
            config.image = trimmed.slice('image:'.length).trim();
            continue;
        }
        if (lower.startsWith('placeholder:')) {
            config.placeholder = trimmed.slice('placeholder:'.length).trim();
            continue;
        }
        if (lower.startsWith('place:')) {
            config.placeholder = trimmed.slice('place:'.length).trim();
            continue;
        }

        config.optionLines.push(trimmed);
    }

    config.title = config.title.slice(0, 256);
    config.description = config.description.slice(0, 4096);
    config.placeholder = config.placeholder.slice(0, 100);
    config.image = config.image.slice(0, 400);
    config.optionLines = config.optionLines.slice(0, 200);

    return config;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rrcreate')
        .setDescription('Create a reaction-role select menu (chat line setup)'),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
            await logger.logPermissionDenied(interaction, 'rrcreate', 'Bot missing Manage Roles');
            return interaction.reply({ content: 'I need the Manage Roles permission.', ephemeral: true });
        }

        if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
            await logger.logPermissionDenied(interaction, 'rrcreate', 'User missing Manage Roles');
            return interaction.reply({ content: 'You need Manage Roles to create reaction roles.', ephemeral: true });
        }

        if (!interaction.channel || !interaction.channel.isTextBased?.()) {
            return interaction.reply({ content: 'This command can only be used in a text channel.', ephemeral: true });
        }

        const key = `${interaction.guildId}:${interaction.channelId}:${interaction.user.id}`;
        const existing = ACTIVE_SETUP.get(key);
        if (existing) {
            return interaction.reply({
                content: 'You already have an active /rrcreate setup in this channel. Type `done` to finish or `cancel` to abort.',
                ephemeral: true,
            });
        }

        const instructions = [
            '**Reaction role setup started.** Send configuration lines in this channel, then type `done`.',
            '',
            'Optional config lines:',
            '- `title: Your title`',
            '- `description: Your description`',
            '- `image: https://...`',
            '- `placeholder: Choose roles...`',
            '',
            'Role option lines (one per line):',
            '- `@Role(or role ID) | Label | Description | Emoji`',
            '',
            'Type `cancel` to abort.',
        ].join('\n');

        await interaction.reply({ content: instructions, ephemeral: true });

        const collectedLines = [];

        const collector = interaction.channel.createMessageCollector({
            filter: (m) => m.author?.id === interaction.user.id,
            time: 5 * 60 * 1000,
        });

        ACTIVE_SETUP.set(key, collector);

        collector.on('collect', (m) => {
            const text = String(m.content || '').trim();
            const lower = text.toLowerCase();
            if (lower === 'done') {
                collector.stop('done');
                return;
            }
            if (lower === 'cancel') {
                collector.stop('cancel');
                return;
            }
            const parts = String(m.content || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            collectedLines.push(...parts);
        });

        collector.on('end', (_collected, reason) => {
            ACTIVE_SETUP.delete(key);
            void (async () => {
                if (reason !== 'done') {
                    const msg = reason === 'cancel'
                        ? 'Reaction role setup cancelled.'
                        : 'Reaction role setup timed out. Re-run `/rrcreate` to start again.';
                    try { await interaction.editReply({ content: msg }); } catch (_) {}
                    return;
                }

                const config = parseConfigLines(collectedLines);
                const safeImage = config.image ? sanitiseUrl(config.image) : null;

                const errors = [];
                if (config.image && !safeImage) errors.push('Invalid image URL (must be http/https).');

                const parsedOptions = [];
                for (const line of config.optionLines) {
                    if (parsedOptions.length >= 25) break;
                    const parts = line.split('|').map(p => p.trim());
                    const roleStr = parts[0] || '';
                    const labelStr = parts[1] || '';
                    const descStr = parts[2] || '';
                    const emojiStr = parts[3] || '';

                    const roleId = parseRoleId(roleStr);
                    if (!roleId) {
                        errors.push(`Invalid role (use a role mention or role ID): ${line}`);
                        continue;
                    }
                    if (roleId === interaction.guildId) {
                        errors.push('You cannot use @everyone.');
                        continue;
                    }
                    if (parsedOptions.some(o => o.roleId === roleId)) continue;

                    // eslint-disable-next-line no-await-in-loop
                    const role = interaction.guild.roles.cache.get(roleId) || (await interaction.guild.roles.fetch(roleId).catch(() => null));
                    if (!role) {
                        errors.push(`Role not found: ${roleId}`);
                        continue;
                    }
                    if (role.managed) {
                        errors.push(`Role is managed and cannot be assigned: ${role.name}`);
                        continue;
                    }
                    if (me.roles.highest.comparePositionTo(role) <= 0) {
                        errors.push(`My role must be higher than: ${role.name}`);
                        continue;
                    }

                    const label = (labelStr || role.name).slice(0, 100);
                    const desc = descStr ? descStr.slice(0, 100) : undefined;
                    const emoji = emojiStr ? parseEmoji(emojiStr) : undefined;

                    parsedOptions.push({
                        roleId,
                        value: roleId,
                        label,
                        description: desc,
                        emoji,
                    });
                }

                if (!parsedOptions.length) {
                    const hint = 'Enter role options as one per line: `@Role | Label | Description | Emoji` (label/desc/emoji optional).';
                    try {
                        await interaction.editReply({
                            content: `No valid role options found.\n${hint}${errors.length ? `\n\nErrors:\n- ${errors.join('\n- ')}` : ''}`,
                        });
                    } catch (_) {}
                    return;
                }

                const embed = new EmbedBuilder();
                try {
                    const { applyDefaultColour } = require('../utils/guildColourStore');
                    applyDefaultColour(embed, interaction.guildId);
                } catch (_) {
                    embed.setColor(0x5865f2);
                }

                if (config.title) embed.setTitle(config.title);
                if (config.description) embed.setDescription(config.description);
                if (!config.title && !config.description) embed.setDescription('Choose your roles from the menu below.');
                if (safeImage) embed.setImage(safeImage);

                let storedPanel;
                try {
                    storedPanel = reactionRoleStore.createPanel(interaction.guildId, {
                        creatorId: interaction.user.id,
                        channelId: interaction.channelId,
                        embed: {
                            title: config.title || null,
                            description: config.description || null,
                            image: safeImage || null,
                        },
                        placeholder: config.placeholder || 'Choose your roles',
                        options: parsedOptions,
                    });
                } catch (err) {
                    console.error('Failed to store reaction role panel:', err);
                    try { await interaction.editReply({ content: 'Failed to save the reaction role panel. Please try again.' }); } catch (_) {}
                    return;
                }

                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`rr:panel:${storedPanel.id}`)
                    .setPlaceholder(storedPanel.placeholder || 'Choose your roles')
                    .setMinValues(0)
                    .setMaxValues(Math.min(storedPanel.options.length, 25))
                    .addOptions(storedPanel.options.map(o => ({
                        label: o.label,
                        value: o.value,
                        description: o.description,
                        emoji: o.emoji,
                    })));

                const row = new ActionRowBuilder().addComponents(menu);

                try {
                    const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
                    reactionRoleStore.setPanelMessage(interaction.guildId, storedPanel.id, interaction.channelId, msg.id);
                    const url = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${msg.id}`;
                    await interaction.editReply({ content: `Reaction role menu posted.\n${url}${errors.length ? `\n\nWarnings:\n- ${errors.join('\n- ')}` : ''}` });
                } catch (err) {
                    console.error('Failed to post reaction role panel:', err);
                    reactionRoleStore.removePanel(interaction.guildId, storedPanel.id);
                    try { await interaction.editReply({ content: 'Failed to post the reaction role menu in this channel. Check my permissions and try again.' }); } catch (_) {}
                }
            })();
        });
    },
};

