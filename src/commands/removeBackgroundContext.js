const {
  ApplicationCommandType,
  AttachmentBuilder,
  ContextMenuCommandBuilder,
} = require('discord.js');
const premiumManager = require('../utils/premiumManager');
const removeBgUsageStore = require('../utils/removeBgUsageStore');

const fetch = globalThis.fetch;
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const DAILY_FREE_LIMIT = 1;
const MAX_GIF_SIZE_BYTES = Number(process.env.REMOVE_BG_GIF_MAX_BYTES || 8 * 1024 * 1024);

function looksLikeGif(nameOrUrl, contentType) {
  const value = String(nameOrUrl || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  return ct.includes('gif') || value.endsWith('.gif') || /\.gif(?:\?|$)/i.test(value);
}

function looksLikeImageAttachment(attachment) {
  if (!attachment?.url) return false;
  const ct = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  const url = String(attachment.url || '').toLowerCase();
  if (ct.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)(\?|$)/i.test(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)(\?|$)/i.test(url);
}

function resolveImageSource(message) {
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const attachment of attachments) {
    if (!looksLikeImageAttachment(attachment)) continue;
    return {
      url: attachment.url,
      size: typeof attachment.size === 'number' ? attachment.size : null,
      isGif: looksLikeGif(attachment.name || attachment.url, attachment.contentType),
    };
  }

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    const candidate = embed?.image?.url || embed?.thumbnail?.url || null;
    if (!candidate) continue;
    return {
      url: candidate,
      size: null,
      isGif: looksLikeGif(candidate, null),
    };
  }

  return null;
}

function extractRemoveBgError(text) {
  let message = 'RemoveBG API error';
  try {
    const data = JSON.parse(text || '{}');
    message = data?.errors?.[0]?.title || data?.errors?.[0]?.detail || data?.error || message;
  } catch (_) {}
  return message;
}

async function removeBackgroundFromUrl(url) {
  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': REMOVE_BG_API_KEY },
    body: new URLSearchParams({
      image_url: url,
      size: 'auto',
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(extractRemoveBgError(text));
  }

  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Remove Background')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const targetMessage = interaction.targetMessage;
    if (!targetMessage) {
      await interaction.reply({ content: 'Could not resolve that message.', ephemeral: true });
      return;
    }

    if (!REMOVE_BG_API_KEY) {
      await interaction.reply({
        content: 'RemoveBG API key is not configured. Set REMOVE_BG_API_KEY in your environment.',
        ephemeral: true,
      });
      return;
    }

    const source = resolveImageSource(targetMessage);
    if (!source?.url) {
      await interaction.reply({
        content: 'That message does not contain an image or GIF attachment.',
        ephemeral: true,
      });
      return;
    }

    if (source.isGif && source.size && source.size > MAX_GIF_SIZE_BYTES) {
      await interaction.reply({
        content: `That GIF is too large. Please use one under ${Math.floor(MAX_GIF_SIZE_BYTES / (1024 * 1024))} MB.`,
        ephemeral: true,
      });
      return;
    }

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

    await interaction.deferReply({ ephemeral: true });

    try {
      const output = await removeBackgroundFromUrl(source.url);
      const file = new AttachmentBuilder(output, { name: 'no-bg.png' });
      const content = source.isGif
        ? 'GIF processed (output is a PNG without the background):'
        : 'Background removed:';
      await interaction.editReply({ content, files: [file] });

      if (!hasServerPremium && usageInfo) {
        const note = `Free remove background uses remaining today for this server: ${usageInfo.remaining} of ${DAILY_FREE_LIMIT}.`;
        try { await interaction.followUp({ content: note, ephemeral: true }); } catch (_) {}
      }
    } catch (err) {
      const message = err?.message || 'Unknown error';
      await interaction.editReply({ content: `Failed to remove background: ${message}` });
    }
  },
};
