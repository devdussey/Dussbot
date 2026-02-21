// @ts-nocheck
const {
    SlashCommandBuilder,
    PermissionsBitField,
    parseEmoji,
} = require('discord.js');
const logger = require('../utils/securityLogger');

const fetch = globalThis.fetch;

function isHttpUrl(value) {
    if (!value) return false;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
    } catch (_) {
        return false;
    }
}

function getAttachmentUrl(attachment) {
    if (!attachment) return null;
    return attachment.url || attachment.proxyURL || null;
}

function buildEmojiCdnUrl(id, animated, size = 128, extOverride) {
    const ext = extOverride || (animated ? 'gif' : 'png');
    return `https://cdn.discordapp.com/emojis/${id}.${ext}?size=${size}&quality=lossless`;
}

function sanitizeEmojiName(name, fallback = 'emoji') {
    const trimmed = String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
    const finalName = trimmed || fallback;
    return finalName.slice(0, 32);
}

function findCachedEmoji(client, id) {
    if (!client || !id) return null;
    try {
        if (client.emojis?.cache?.has(id)) {
            return client.emojis.cache.get(id);
        }
    } catch (_) {
        // Ignore and fall back to guild scan.
    }
    for (const guild of client.guilds.cache.values()) {
        const emoji = guild.emojis.cache.get(id);
        if (emoji) return emoji;
    }
    return null;
}

async function sniffEmojiFromCdn(id) {
    const variants = [
        { ext: 'gif', animated: true },
        { ext: 'png', animated: false },
        { ext: 'webp', animated: false },
    ];

    for (const variant of variants) {
        const url = buildEmojiCdnUrl(id, variant.animated, 128, variant.ext);
        try {
            let response = await fetch(url, { method: 'HEAD' });
            if (!response.ok) {
                response = await fetch(url);
            }
            if (response.ok) {
                return { animated: variant.animated, explicitUrl: url };
            }
        } catch (_) {
            // Try next variant.
        }
    }
    return null;
}

async function parseEmojiInput(input, client) {
    if (!input) return null;

    const parsed = parseEmoji(input);
    if (parsed?.id) {
        const cachedEmoji = findCachedEmoji(client, parsed.id);
        const animated = Boolean(parsed.animated || cachedEmoji?.animated);
        const explicitUrl = cachedEmoji?.imageURL({ extension: animated ? 'gif' : 'png', size: 128 }) || null;
        const name = cachedEmoji?.name || parsed.name;
        return { id: parsed.id, name, animated, explicitUrl };
    }

    const urlMatch = input.match(/https?:\/\/(?:media\.)?discord(?:app)?\.com\/emojis\/([0-9]{15,25})\.(png|webp|gif)/i);
    if (urlMatch) {
        const id = urlMatch[1];
        const ext = urlMatch[2].toLowerCase();
        return {
            id,
            name: undefined,
            animated: ext === 'gif',
            explicitUrl: input,
        };
    }

    const idMatch = input.match(/^([0-9]{15,25})$/);
    if (idMatch) {
        const id = idMatch[1];
        const cachedEmoji = findCachedEmoji(client, id);
        if (cachedEmoji) {
            const animated = Boolean(cachedEmoji.animated);
            const explicitUrl = cachedEmoji.imageURL({ extension: animated ? 'gif' : 'png', size: 128 });
            return { id, name: cachedEmoji.name, animated, explicitUrl };
        }

        const sniffed = await sniffEmojiFromCdn(id);
        if (sniffed) {
            return { id, name: undefined, animated: sniffed.animated, explicitUrl: sniffed.explicitUrl };
        }

        return { id, name: undefined, animated: false, explicitUrl: null };
    }

    return null;
}

function extractEmojiId(input) {
    if (!input) return null;
    const parsed = parseEmoji(input);
    if (parsed?.id) return parsed.id;

    const trimmed = String(input).trim();
    if (/^[0-9]{15,25}$/.test(trimmed)) return trimmed;

    const urlMatch = trimmed.match(/\/emojis\/([0-9]{15,25})\.(?:png|webp|gif)/i);
    if (urlMatch) return urlMatch[1];

    return null;
}

async function resolveGuildEmoji(guild, input) {
    const needle = String(input || '').trim();
    if (!needle) return null;

    const id = extractEmojiId(needle);
    if (id) {
        try {
            return await guild.emojis.fetch(id);
        } catch (_) {
            return guild.emojis.cache.get(id) || null;
        }
    }

    const lower = needle.toLowerCase();
    let found = guild.emojis.cache.find(emoji => emoji.name.toLowerCase() === lower) || null;
    if (found) return found;

    try {
        const fetched = await guild.emojis.fetch();
        found = fetched.find(emoji => emoji.name.toLowerCase() === lower) || null;
    } catch (_) {
        found = null;
    }
    return found;
}

function formatEmojiMention(emoji) {
    if (!emoji) return '';
    return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
}

async function handleAdd(interaction) {
    const nameInput = interaction.options.getString('name', true);
    const url = interaction.options.getString('url');
    const file = interaction.options.getAttachment('file');

    const fileUrl = getAttachmentUrl(file);
    const source = fileUrl || url;
    if (!source) {
        return interaction.reply({ content: 'Provide a media URL or upload a file.', ephemeral: true });
    }
    if (!isHttpUrl(source)) {
        return interaction.reply({ content: 'Source must be a valid http/https URL.', ephemeral: true });
    }

    const name = sanitizeEmojiName(nameInput, 'emoji');

    await interaction.deferReply({ ephemeral: true });
    try {
        const created = await interaction.guild.emojis.create({
            attachment: source,
            name,
        });
        const mention = formatEmojiMention(created);
        return interaction.editReply({ content: `Added emoji ${mention}` });
    } catch (err) {
        let reason = 'Failed to add emoji.';
        if (err?.message?.includes('Maximum number of emojis reached')) {
            reason = 'This server has reached the emoji limit.';
        }
        return interaction.editReply({ content: reason });
    }
}

async function handleClone(interaction) {
    const input = interaction.options.getString('input', true);
    const nameOverride = interaction.options.getString('name');

    const parsed = await parseEmojiInput(input, interaction.client);
    if (!parsed) {
        return interaction.reply({
            content: 'Provide a custom emoji mention like <:name:id>, an emoji ID, or a valid emoji CDN URL.',
            ephemeral: true,
        });
    }

    const source = parsed.explicitUrl || buildEmojiCdnUrl(parsed.id, parsed.animated);
    const name = sanitizeEmojiName(nameOverride || parsed.name || `emoji_${parsed.id}`, `emoji_${parsed.id}`);

    await interaction.deferReply({ ephemeral: true });
    try {
        const created = await interaction.guild.emojis.create({
            attachment: source,
            name,
        });
        const mention = formatEmojiMention(created);
        return interaction.editReply({ content: `Cloned emoji ${mention}` });
    } catch (err) {
        let reason = 'Failed to clone emoji.';
        if (err?.message?.includes('Maximum number of emojis reached')) {
            reason = 'This server has reached the emoji limit.';
        }
        return interaction.editReply({ content: reason });
    }
}

async function handleEdit(interaction) {
    const emojiInput = interaction.options.getString('emoji', true);
    const nameInput = interaction.options.getString('name', true);
    const name = sanitizeEmojiName(nameInput, 'emoji');

    await interaction.deferReply({ ephemeral: true });

    const emoji = await resolveGuildEmoji(interaction.guild, emojiInput);
    if (!emoji) {
        return interaction.editReply({ content: 'Emoji not found in this server.' });
    }

    try {
        const edited = await interaction.guild.emojis.edit(emoji.id, { name });
        const mention = formatEmojiMention(edited);
        return interaction.editReply({ content: `Updated emoji ${mention}` });
    } catch (err) {
        return interaction.editReply({ content: `Failed to edit emoji: ${err.message}` });
    }
}

async function handleDelete(interaction) {
    const emojiInput = interaction.options.getString('emoji', true);

    await interaction.deferReply({ ephemeral: true });

    const emoji = await resolveGuildEmoji(interaction.guild, emojiInput);
    if (!emoji) {
        return interaction.editReply({ content: 'Emoji not found in this server.' });
    }

    const snapshot = `${emoji.animated ? '<a' : '<'}:${emoji.name}:${emoji.id}>`;
    try {
        await interaction.guild.emojis.delete(emoji.id);
        return interaction.editReply({ content: `Deleted emoji ${snapshot}` });
    } catch (err) {
        return interaction.editReply({ content: `Failed to delete emoji: ${err.message}` });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emoji')
        .setDescription('Manage server emojis with add/edit/delete/clone')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Add an emoji from URL or uploaded media')
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('Emoji name')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('url')
                        .setDescription('Direct image/GIF URL')
                        .setRequired(false)
                )
                .addAttachmentOption(opt =>
                    opt
                        .setName('file')
                        .setDescription('Upload image/GIF file')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('clone')
                .setDescription('Clone an existing custom emoji')
                .addStringOption(opt =>
                    opt
                        .setName('input')
                        .setDescription('Emoji mention, ID, or emoji CDN URL')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('Optional new emoji name')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('edit')
                .setDescription('Rename an existing server emoji')
                .addStringOption(opt =>
                    opt
                        .setName('emoji')
                        .setDescription('Emoji ID, mention, or exact name')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('New emoji name')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('delete')
                .setDescription('Delete an emoji from this server')
                .addStringOption(opt =>
                    opt
                        .setName('emoji')
                        .setDescription('Emoji ID, mention, or exact name')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        const botMember = interaction.guild.members.me;
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageGuildExpressions)) {
            await logger.logPermissionDenied(interaction, 'emoji', 'Bot missing Manage Expressions');
            return interaction.reply({ content: 'I need the Manage Expressions permission.', ephemeral: true });
        }

        if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuildExpressions)) {
            await logger.logPermissionDenied(interaction, 'emoji', 'User missing Manage Expressions');
            return interaction.reply({ content: 'You need Manage Expressions to use this command.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'add') return handleAdd(interaction);
        if (sub === 'clone') return handleClone(interaction);
        if (sub === 'edit') return handleEdit(interaction);
        if (sub === 'delete') return handleDelete(interaction);

        return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    },
};

export {};


