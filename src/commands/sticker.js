const {
    SlashCommandBuilder,
    PermissionsBitField,
    Routes,
    StickerFormatType,
} = require('discord.js');
const sharp = require('sharp');
const logger = require('../utils/securityLogger');

const fetch = globalThis.fetch;

const STICKER_EDGE = 320;
const MAX_STICKER_BYTES = 512 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const DEFAULT_STICKER_TAG = '🙂';
const STICKER_ID_REGEX = /([0-9]{15,25})/;

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

function sanitizeStickerName(name, fallback = 'sticker') {
    const raw = String(name || '').trim();
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
    let finalName = normalized || fallback;
    if (finalName.length < 2) finalName = `${finalName}__`;
    return finalName.slice(0, 30);
}

function normalizeStickerTags(input, fallback = DEFAULT_STICKER_TAG) {
    const cleaned = String(input || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .join(', ')
        .trim();
    const finalValue = cleaned || fallback;
    return finalValue.slice(0, 200);
}

function sanitizeDescription(input) {
    if (input === null) return null;
    if (input === undefined) return undefined;
    const trimmed = String(input).trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, 100);
}

function inferExtensionFromValue(value, fallback = 'png') {
    if (!value) return fallback;
    const match = String(value).match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    if (!match) return fallback;
    return match[1].toLowerCase();
}

function inferBaseName(value, fallback = 'sticker') {
    if (!value) return fallback;
    const raw = String(value).trim();
    if (!raw) return fallback;

    if (/^[0-9]{15,25}$/.test(raw)) return `sticker_${raw}`;

    try {
        const url = new URL(raw);
        const fileName = url.pathname.split('/').filter(Boolean).pop();
        if (fileName) {
            return fileName.split('.').slice(0, -1).join('.') || fallback;
        }
    } catch (_) {
        // Continue with non-URL extraction.
    }

    const fileName = raw.split('/').pop();
    if (!fileName) return fallback;
    return fileName.split('.').slice(0, -1).join('.') || fallback;
}

function extractStickerId(input) {
    if (!input) return null;
    const raw = String(input).trim();
    if (!raw) return null;

    if (/^[0-9]{15,25}$/.test(raw)) return raw;

    const pathMatch = raw.match(/\/stickers\/([0-9]{15,25})/i);
    if (pathMatch) return pathMatch[1];

    const genericMatch = raw.match(STICKER_ID_REGEX);
    return genericMatch ? genericMatch[1] : null;
}

function stickerFormatToExtension(formatType) {
    switch (formatType) {
        case StickerFormatType.Lottie:
            return 'json';
        case StickerFormatType.GIF:
            return 'gif';
        case StickerFormatType.APNG:
            return 'png';
        case StickerFormatType.PNG:
        default:
            return 'png';
    }
}

async function fetchStickerMetadata(client, stickerId) {
    if (!client || !stickerId) return null;
    try {
        return await client.rest.get(Routes.sticker(stickerId));
    } catch (_) {
        return null;
    }
}

async function fetchBufferFromUrl(url) {
    if (!isHttpUrl(url)) {
        throw new Error('Source must be an http/https URL.');
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download media (${response.status}).`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
        throw new Error('Downloaded media was empty.');
    }
    if (buffer.length > MAX_INPUT_BYTES) {
        throw new Error('Input media is too large (25 MB max).');
    }

    return {
        buffer,
        contentType: response.headers.get('content-type') || '',
    };
}

async function fetchStickerBufferByIdOrUrl(idOrUrl, preferredExt) {
    const tryUrls = [];

    if (/^[0-9]{15,25}$/.test(idOrUrl)) {
        const baseExts = ['png', 'apng', 'gif', 'json'];
        const order = preferredExt && baseExts.includes(preferredExt)
            ? [preferredExt, ...baseExts.filter(ext => ext !== preferredExt)]
            : baseExts;
        for (const ext of order) {
            tryUrls.push(`https://cdn.discordapp.com/stickers/${idOrUrl}.${ext}`);
        }
    } else if (isHttpUrl(idOrUrl)) {
        tryUrls.push(idOrUrl);
    } else {
        return null;
    }

    for (const url of tryUrls) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length) continue;
            if (buffer.length > MAX_INPUT_BYTES) continue;
            return {
                buffer,
                sourceUrl: url,
                contentType: response.headers.get('content-type') || '',
            };
        } catch (_) {
            // Try the next candidate URL.
        }
    }
    return null;
}

function looksLikeJsonSticker(buffer, hintExtension, contentType) {
    const ext = String(hintExtension || '').toLowerCase();
    const type = String(contentType || '').toLowerCase();
    if (ext === 'json') return true;
    if (type.includes('application/json') || type.includes('text/json')) return true;
    const head = buffer.slice(0, 256).toString('utf8').trimStart();
    return head.startsWith('{');
}

async function renderStaticSticker(buffer) {
    const colourSteps = [256, 192, 128, 96, 64, 48, 32];
    let lastSize = 0;

    for (const colours of colourSteps) {
        const out = await sharp(buffer, { animated: false, failOn: 'none' })
            .resize({
                width: STICKER_EDGE,
                height: STICKER_EDGE,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png({
                palette: true,
                colours,
                quality: 80,
                compressionLevel: 9,
                effort: 10,
            })
            .toBuffer();

        lastSize = out.length;
        if (out.length <= MAX_STICKER_BYTES) {
            return out;
        }
    }

    throw new Error(`Converted PNG sticker is too large (${Math.ceil(lastSize / 1024)} KB).`);
}

async function renderAnimatedSticker(buffer) {
    const colourSteps = [192, 128, 96, 64, 48, 32];
    let lastSize = 0;

    for (const colours of colourSteps) {
        const out = await sharp(buffer, { animated: true, failOn: 'none' })
            .resize({
                width: STICKER_EDGE,
                height: STICKER_EDGE,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .gif({
                effort: 10,
                colours,
                dither: 0.8,
            })
            .toBuffer();

        lastSize = out.length;
        if (out.length <= MAX_STICKER_BYTES) {
            return out;
        }
    }

    throw new Error(`Converted GIF sticker is too large (${Math.ceil(lastSize / 1024)} KB).`);
}

async function normalizeToStickerAsset(buffer, opts = {}) {
    const { hintExtension, contentType, forceAnimated } = opts;

    if (looksLikeJsonSticker(buffer, hintExtension, contentType)) {
        if (buffer.length > MAX_STICKER_BYTES) {
            throw new Error('Lottie JSON sticker file is too large.');
        }
        return {
            buffer,
            extension: 'json',
            transformed: false,
            animated: true,
        };
    }

    let metadata;
    try {
        metadata = await sharp(buffer, { animated: true, failOn: 'none' }).metadata();
    } catch (_) {
        throw new Error('Unsupported media. Use PNG, JPG, WEBP, GIF, APNG, or Lottie JSON.');
    }

    const isAnimated = Boolean(
        forceAnimated
        || metadata.pages > 1
        || metadata.format === 'gif'
    );

    if (isAnimated) {
        const converted = await renderAnimatedSticker(buffer);
        return {
            buffer: converted,
            extension: 'gif',
            transformed: true,
            animated: true,
        };
    }

    const converted = await renderStaticSticker(buffer);
    return {
        buffer: converted,
        extension: 'png',
        transformed: true,
        animated: false,
    };
}

async function createStickerWithFallback(guild, params) {
    const {
        name,
        tags,
        description,
        normalized,
        sourceBuffer,
    } = params;

    const buildPayload = (asset) => ({
        file: {
            attachment: asset.buffer,
            name: `${name}.${asset.extension}`,
        },
        name,
        tags,
        description,
    });

    try {
        const created = await guild.stickers.create(buildPayload(normalized));
        return { created, finalAsset: normalized, downgradedFromGif: false };
    } catch (err) {
        if (normalized.extension !== 'gif') throw err;

        // If GIF creation fails (feature limits or format issues), fall back to static PNG.
        const pngBuffer = await renderStaticSticker(sourceBuffer);
        const pngAsset = {
            buffer: pngBuffer,
            extension: 'png',
            transformed: true,
            animated: false,
        };
        const created = await guild.stickers.create(buildPayload(pngAsset));
        return { created, finalAsset: pngAsset, downgradedFromGif: true };
    }
}

async function resolveMediaSource(interaction, sourceInput, attachment) {
    if (!sourceInput && !attachment) {
        throw new Error('Provide a media URL, sticker ID/URL, or uploaded file.');
    }

    if (attachment) {
        const attachmentUrl = getAttachmentUrl(attachment);
        if (!isHttpUrl(attachmentUrl)) {
            throw new Error('Attached file URL could not be read. Try re-uploading the file.');
        }
        if (attachment.size && attachment.size > MAX_INPUT_BYTES) {
            throw new Error('Attached file is too large (25 MB max).');
        }
        const { buffer, contentType } = await fetchBufferFromUrl(attachmentUrl);
        return {
            buffer,
            sourceUrl: attachmentUrl,
            sourceName: attachment.name || null,
            contentType: attachment.contentType || contentType || '',
            stickerMetadata: null,
            sourceStickerId: null,
        };
    }

    const sourceStickerId = extractStickerId(sourceInput);
    const stickerMetadata = sourceStickerId
        ? await fetchStickerMetadata(interaction.client, sourceStickerId)
        : null;
    const preferredExt = stickerMetadata
        ? stickerFormatToExtension(stickerMetadata.format_type)
        : undefined;

    const stickerAsset = await fetchStickerBufferByIdOrUrl(sourceInput, preferredExt);
    if (!stickerAsset) {
        throw new Error('Could not download source media from that input.');
    }

    return {
        buffer: stickerAsset.buffer,
        sourceUrl: stickerAsset.sourceUrl || sourceInput,
        sourceName: null,
        contentType: stickerAsset.contentType || '',
        stickerMetadata,
        sourceStickerId,
    };
}

async function resolveGuildSticker(guild, input) {
    const needle = String(input || '').trim();
    if (!needle) return null;

    const id = extractStickerId(needle);
    if (id) {
        try {
            return await guild.stickers.fetch(id);
        } catch (_) {
            return guild.stickers.cache.get(id) || null;
        }
    }

    const lowerNeedle = needle.toLowerCase();
    let found = guild.stickers.cache.find(sticker => sticker.name.toLowerCase() === lowerNeedle) || null;
    if (found) return found;

    try {
        const fetched = await guild.stickers.fetch();
        found = fetched.find(sticker => sticker.name.toLowerCase() === lowerNeedle) || null;
    } catch (_) {
        found = null;
    }
    return found;
}

async function handleAdd(interaction) {
    const nameInput = interaction.options.getString('name', true);
    const sourceUrl = interaction.options.getString('url');
    const attachment = interaction.options.getAttachment('file');
    const tagsInput = interaction.options.getString('tags');
    const descriptionInput = interaction.options.getString('description');

    if (!sourceUrl && !attachment) {
        return interaction.reply({
            content: 'Provide a media URL or upload a file for the sticker.',
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const source = await resolveMediaSource(interaction, sourceUrl, attachment);
        const hintExtension = inferExtensionFromValue(source.sourceName || source.sourceUrl, 'png');
        const normalized = await normalizeToStickerAsset(source.buffer, {
            hintExtension,
            contentType: source.contentType,
        });

        const name = sanitizeStickerName(nameInput, 'sticker');
        const tags = normalizeStickerTags(tagsInput, DEFAULT_STICKER_TAG);
        const description = sanitizeDescription(descriptionInput);

        const { created, finalAsset, downgradedFromGif } = await createStickerWithFallback(interaction.guild, {
            name,
            tags,
            description,
            normalized,
            sourceBuffer: source.buffer,
        });

        const reshapeNote = finalAsset.transformed
            ? `auto-shaped to ${STICKER_EDGE}x${STICKER_EDGE} ${finalAsset.extension.toUpperCase()}`
            : `kept as ${finalAsset.extension.toUpperCase()}`;
        const fallbackNote = downgradedFromGif ? ' GIF fallback to PNG applied.' : '';
        return interaction.editReply({
            content: `Added sticker "${created.name}" (ID: ${created.id}) - ${reshapeNote}.${fallbackNote}`,
        });
    } catch (err) {
        return interaction.editReply({ content: `Failed to add sticker: ${err.message}` });
    }
}

async function handleClone(interaction) {
    const sourceInput = interaction.options.getString('source');
    const attachment = interaction.options.getAttachment('file');
    const nameInput = interaction.options.getString('name');
    const tagsInput = interaction.options.getString('tags');
    const descriptionInput = interaction.options.getString('description');

    if (!sourceInput && !attachment) {
        return interaction.reply({
            content: 'Provide a sticker ID/URL, media URL, or upload a file to clone.',
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const source = await resolveMediaSource(interaction, sourceInput, attachment);
        const hintExtension = inferExtensionFromValue(source.sourceName || source.sourceUrl, 'png');
        const normalized = await normalizeToStickerAsset(source.buffer, {
            hintExtension,
            contentType: source.contentType,
            forceAnimated: source.stickerMetadata?.format_type === StickerFormatType.GIF,
        });

        const fallbackName = source.stickerMetadata?.name
            || inferBaseName(source.sourceName || source.sourceUrl || sourceInput, 'sticker_clone');
        const name = sanitizeStickerName(nameInput || fallbackName, 'sticker_clone');
        const tags = normalizeStickerTags(tagsInput || source.stickerMetadata?.tags, DEFAULT_STICKER_TAG);
        const description = sanitizeDescription(
            descriptionInput !== null ? descriptionInput : source.stickerMetadata?.description
        );

        const { created, finalAsset, downgradedFromGif } = await createStickerWithFallback(interaction.guild, {
            name,
            tags,
            description,
            normalized,
            sourceBuffer: source.buffer,
        });

        const reshapeNote = finalAsset.transformed
            ? `auto-shaped to ${STICKER_EDGE}x${STICKER_EDGE} ${finalAsset.extension.toUpperCase()}`
            : `kept as ${finalAsset.extension.toUpperCase()}`;
        const fallbackNote = downgradedFromGif ? ' GIF fallback to PNG applied.' : '';
        return interaction.editReply({
            content: `Cloned sticker as "${created.name}" (ID: ${created.id}) - ${reshapeNote}.${fallbackNote}`,
        });
    } catch (err) {
        return interaction.editReply({ content: `Failed to clone sticker: ${err.message}` });
    }
}

async function handleEdit(interaction) {
    const stickerInput = interaction.options.getString('sticker', true);
    const nameInput = interaction.options.getString('name');
    const tagsInput = interaction.options.getString('tags');
    const descriptionInput = interaction.options.getString('description');
    const normalizedDescription = descriptionInput !== null ? sanitizeDescription(descriptionInput) : undefined;
    const clearDescription = interaction.options.getBoolean('clear_description') || false;

    if (!nameInput && !tagsInput && !descriptionInput && !clearDescription) {
        return interaction.reply({
            content: 'Provide at least one field to edit: name, tags, description, or clear_description.',
            ephemeral: true,
        });
    }
    if (descriptionInput !== null && normalizedDescription === undefined) {
        return interaction.reply({
            content: 'Description cannot be blank. Use clear_description to remove it.',
            ephemeral: true,
        });
    }
    if (descriptionInput && clearDescription) {
        return interaction.reply({
            content: 'Use either description or clear_description, not both.',
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    const sticker = await resolveGuildSticker(interaction.guild, stickerInput);
    if (!sticker) {
        return interaction.editReply({ content: 'Sticker not found in this server.' });
    }

    const payload = {};
    if (nameInput) payload.name = sanitizeStickerName(nameInput, sticker.name);
    if (tagsInput) payload.tags = normalizeStickerTags(tagsInput, sticker.tags || DEFAULT_STICKER_TAG);
    if (descriptionInput !== null) payload.description = normalizedDescription;
    if (clearDescription) payload.description = null;

    try {
        const edited = await interaction.guild.stickers.edit(sticker.id, payload);
        return interaction.editReply({
            content: `Updated sticker "${edited.name}" (ID: ${edited.id}).`,
        });
    } catch (err) {
        return interaction.editReply({ content: `Failed to edit sticker: ${err.message}` });
    }
}

async function handleDelete(interaction) {
    const stickerInput = interaction.options.getString('sticker', true);
    await interaction.deferReply({ ephemeral: true });

    const sticker = await resolveGuildSticker(interaction.guild, stickerInput);
    if (!sticker) {
        return interaction.editReply({ content: 'Sticker not found in this server.' });
    }

    try {
        await interaction.guild.stickers.delete(sticker.id);
        return interaction.editReply({
            content: `Deleted sticker "${sticker.name}" (ID: ${sticker.id}).`,
        });
    } catch (err) {
        return interaction.editReply({ content: `Failed to delete sticker: ${err.message}` });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sticker')
        .setDescription('Manage server stickers with URL/file input support')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Add a new sticker from URL or uploaded media')
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('Sticker name')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('url')
                        .setDescription('Direct media URL (or sticker CDN URL)')
                        .setRequired(false)
                )
                .addAttachmentOption(opt =>
                    opt
                        .setName('file')
                        .setDescription('Upload media file')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('tags')
                        .setDescription('Sticker tags (defaults to 🙂)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('description')
                        .setDescription('Optional sticker description')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('clone')
                .setDescription('Clone a sticker/media source into this server')
                .addStringOption(opt =>
                    opt
                        .setName('source')
                        .setDescription('Sticker ID/URL or direct media URL')
                        .setRequired(false)
                )
                .addAttachmentOption(opt =>
                    opt
                        .setName('file')
                        .setDescription('Upload media file to clone')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('Optional new sticker name')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('tags')
                        .setDescription('Optional tags (defaults from source when possible)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('description')
                        .setDescription('Optional description override')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('edit')
                .setDescription('Edit an existing server sticker')
                .addStringOption(opt =>
                    opt
                        .setName('sticker')
                        .setDescription('Sticker ID or exact sticker name')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('New sticker name')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('tags')
                        .setDescription('New tags')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('description')
                        .setDescription('New description')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt
                        .setName('clear_description')
                        .setDescription('Clear current description')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('delete')
                .setDescription('Delete a sticker from this server')
                .addStringOption(opt =>
                    opt
                        .setName('sticker')
                        .setDescription('Sticker ID or exact sticker name')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        const botMember = interaction.guild.members.me;
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageGuildExpressions)) {
            await logger.logPermissionDenied(interaction, 'sticker', 'Bot missing Manage Expressions');
            return interaction.reply({ content: 'I need the Manage Expressions permission.', ephemeral: true });
        }

        if (!interaction.member.permissions?.has(PermissionsBitField.Flags.ManageGuildExpressions)) {
            await logger.logPermissionDenied(interaction, 'sticker', 'User missing Manage Expressions');
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
