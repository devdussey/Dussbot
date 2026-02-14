const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fetch = globalThis.fetch;
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const premiumManager = require('../utils/premiumManager');
const removeBgUsageStore = require('../utils/removeBgUsageStore');

const DAILY_FREE_LIMIT = 1;
const MAX_GIF_SIZE_BYTES = Number(process.env.REMOVE_BG_GIF_MAX_BYTES || 8 * 1024 * 1024); // default 8 MB cap for attachments

function resolveUrl(interaction, stringOptName, attachmentOptName) {
    let url = interaction.options.getString?.(stringOptName);
    if (!url) {
        const attachment = interaction.options.getAttachment?.(attachmentOptName);
        if (attachment?.url) return attachment.url;
        if (interaction.options._hoistedOptions) {
            const fileAttachment = interaction.options._hoistedOptions.find(opt => opt.attachment && (!attachmentOptName || opt.name === attachmentOptName));
            if (fileAttachment?.attachment?.url) return fileAttachment.attachment.url;
        }
    }
    if (!url && interaction.targetMessage?.attachments?.size) {
        return interaction.targetMessage.attachments.first().url;
    }
    return url || null;
}

function attachmentSize(interaction, attachmentOptName) {
    const attachment = interaction.options.getAttachment?.(attachmentOptName);
    if (attachment?.size != null) return Number(attachment.size);
    if (interaction.options._hoistedOptions) {
        const fileAttachment = interaction.options._hoistedOptions.find(opt => opt.attachment && (!attachmentOptName || opt.name === attachmentOptName));
        if (fileAttachment?.attachment?.size != null) return Number(fileAttachment.attachment.size);
    }
    return null;
}

async function handleImage(interaction) {
    if (!REMOVE_BG_API_KEY) {
        await interaction.editReply('RemoveBG API key is not configured. Set REMOVE_BG_API_KEY in your environment.');
        return;
    }

    const imageUrl = resolveUrl(interaction, 'image_url', 'image');
    if (!imageUrl) {
        await interaction.editReply('Please provide an image URL or attach an image.');
        return;
    }

    console.log(`[removebg] imageUrl=${imageUrl}`);
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': REMOVE_BG_API_KEY },
        body: new URLSearchParams({
            image_url: imageUrl,
            size: 'auto',
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        let msg = 'RemoveBG API error';
        try {
            const data = JSON.parse(text);
            msg = data?.errors?.[0]?.title || data?.errors?.[0]?.detail || msg;
        } catch (_) {}
        console.log(`[removebg] error status=${response.status} body=${text?.slice(0, 400)}`);
        throw new Error(msg);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const attachment = new AttachmentBuilder(buffer, { name: 'no-bg.png' });
    await interaction.editReply({ content: 'Background removed:', files: [attachment] });
}

async function handleGif(interaction) {
    if (!REMOVE_BG_API_KEY) {
        await interaction.editReply('RemoveBG API key is not configured. Set REMOVE_BG_API_KEY in your environment.');
        return;
    }

    const gifUrl = resolveUrl(interaction, 'gif_url', 'gif');
    const gifAttachment = interaction.options.getAttachment?.('gif');
    if (!gifUrl) {
        await interaction.editReply('Please provide a GIF URL or attach a GIF.');
        return;
    }

    if (gifAttachment?.contentType && !gifAttachment.contentType.toLowerCase().includes('gif')) {
        await interaction.editReply('The provided file does not look like a GIF. Please use a GIF URL or attachment.');
        return;
    }

    const attachedSize = attachmentSize(interaction, 'gif');
    if (attachedSize && attachedSize > MAX_GIF_SIZE_BYTES) {
        await interaction.editReply(`The attached GIF is too large. Please use a file under ${Math.floor(MAX_GIF_SIZE_BYTES / (1024 * 1024))} MB.`);
        return;
    }

    console.log(`[removebg] gifUrl=${gifUrl}`);
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': REMOVE_BG_API_KEY },
        body: new URLSearchParams({
            image_url: gifUrl,
            size: 'auto',
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        let message = 'RemoveBG API error';
        try {
            const data = JSON.parse(text);
            message = data?.errors?.[0]?.title || data?.errors?.[0]?.detail || data?.error || message;
        } catch (_) {}
        console.log(`[removebg] gif error status=${response.status} body=${text?.slice(0, 400)}`);
        throw new Error(message);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    // remove.bg returns a PNG for GIFs; surface that in the message.
    const attachment = new AttachmentBuilder(buffer, { name: 'no-bg.png' });
    await interaction.editReply({ content: 'GIF processed (output is a PNG without the background):', files: [attachment] });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removebg')
        .setDescription('Remove the background from an image or GIF (GIF returns PNG)')
        .addSubcommand(sub =>
            sub
                .setName('image')
                .setDescription('Remove the background from a static image')
                .addAttachmentOption(option =>
                    option.setName('image')
                        .setDescription('Attach an image to process')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('image_url')
                        .setDescription('URL of the image to process')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('gif')
                .setDescription('Remove the background from a GIF')
                .addAttachmentOption(option =>
                    option.setName('gif')
                        .setDescription('Attach a GIF to process')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('gif_url')
                        .setDescription('URL of the GIF to process')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const hasServerPremium = premiumManager.hasGuildPremium(interaction.guildId) || premiumManager.isGuildBoosted(interaction.guild);
        let usageInfo = null;

        if (!hasServerPremium) {
            const usageKey = interaction.guildId || interaction.user?.id;
            usageInfo = removeBgUsageStore.tryConsume(usageKey, DAILY_FREE_LIMIT);
            if (!usageInfo.allowed) {
                const message = premiumManager.buildUpsellMessage('Remove Background', {
                    freebiesRemaining: usageInfo.remaining,
                    freebiesTotal: DAILY_FREE_LIMIT,
                    extraNote: 'This non-premium server has used its free remove background use for today.',
                });
                await interaction.reply({ content: message, ephemeral: true });
                return;
            }
        }

        await interaction.deferReply();
        const subcommand = interaction.options.getSubcommand(false) || 'image';

        try { console.log(`[removebg] invoked by ${interaction.user?.id} in ${interaction.guild?.id} sub=${subcommand}`); } catch (_) {}

        try {
            if (subcommand === 'gif') {
                await handleGif(interaction);
            } else {
                await handleImage(interaction);
            }

            if (!hasServerPremium && usageInfo) {
                const note = `Free remove background uses remaining today for this server: ${usageInfo.remaining} of ${DAILY_FREE_LIMIT}.`;
                try { await interaction.followUp({ content: note, ephemeral: true }); } catch (_) {}
            }
        } catch (error) {
            try {
                await interaction.editReply(`Failed to remove background: ${error.message}`);
            } catch (_) {
                try { await interaction.followUp({ content: `Failed to remove background: ${error.message}` }); } catch (_) {}
            }
        }
    },
};
