const cmdLogger = require('../utils/logger')('embed');
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { createEmbedModal } = require('../utils/embedBuilder');
const { parseColorInput } = require('../utils/colorParser');

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

function isImageAttachment(attachment) {
    if (!attachment) return false;
    const contentType = (attachment.contentType || '').toLowerCase();
    if (contentType.startsWith('image/')) return true;
    const name = (attachment.name || '').toLowerCase();
    return /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(name);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Create a custom embed')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new embed with a step-by-step builder')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('quick')
                .setDescription('Quickly create an embed')
                // Required options must come before non-required ones
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Embed description')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('title')
                        .setDescription('Embed title')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('color')
                        .setDescription('Embed color (hex code like #ff0000 or color name)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('image')
                        .setDescription('Image URL')
                        .setRequired(false)
                )
                .addAttachmentOption(option =>
                    option
                        .setName('image_upload')
                        .setDescription('Upload an image instead of a URL')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('thumbnail')
                        .setDescription('Thumbnail URL')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send the embed to')
                        .addChannelTypes(ChannelType.GuildText) // Only allow text channels
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            // Show modal for interactive embed creation
            const modal = createEmbedModal();
            await interaction.showModal(modal);

        } else if (subcommand === 'quick') {
            await interaction.deferReply({ ephemeral: true }); // silent, only user sees this

            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');
            const colorInput = interaction.options.getString('color');
            const imageInput = interaction.options.getString('image');
            const imageAttachment = interaction.options.getAttachment('image_upload');
            const thumbnailInput = interaction.options.getString('thumbnail');
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            const imageUrl = sanitiseUrl(imageInput);
            const thumbUrl = sanitiseUrl(thumbnailInput);

            if (!title && !description && !imageAttachment && !imageUrl && !thumbUrl) {
                return interaction.editReply({
                    content: 'Please provide at least one embed field (title, description, image, or thumbnail).'
                });
            }

            try {
                const colour = parseColorInput(colorInput, 0x5865f2);
                const embed = new EmbedBuilder()
                    .setColor(colour);
                const files = [];

                if (title) embed.setTitle(title.slice(0, 256));
                if (description) embed.setDescription(description.slice(0, 4096));

                if (imageAttachment) {
                    if (!isImageAttachment(imageAttachment)) {
                        return interaction.editReply({
                            content: '? Please upload an image file (png, jpg, gif, webp, bmp, or tiff).'
                        });
                    }
                    const filename = imageAttachment.name || 'embed-image';
                    files.push({ attachment: imageAttachment.url, name: filename });
                    embed.setImage(`attachment://${filename}`);
                } else {
                    if (imageUrl) embed.setImage(imageUrl);
                }

                if (thumbUrl) embed.setThumbnail(thumbUrl);

                // Send the embed to the chosen channel
                await targetChannel.send({
                    embeds: [embed],
                    files: files.length ? files : undefined,
                });

                // Let the user know privately it worked
                await interaction.editReply({
                    content: `✅ Your embed has been sent to ${targetChannel}.`
                });

            } catch (error) {
                cmdLogger.error('embed quick failed:', error);
                await interaction.editReply({
                    content: '❌ Error creating embed. Please check your inputs (especially URLs and color format).'
                });
            }
        }
    },
};

