const {
  ApplicationCommandType,
  AttachmentBuilder,
  ContextMenuCommandBuilder,
} = require('discord.js');
const sharp = require('sharp');

const fetch = globalThis.fetch;
const MAX_DIMENSION = 8192;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ALLOWED_SCALES = new Set([2, 4, 8]);
const CONTEXT_SCALE = ALLOWED_SCALES.has(Number(process.env.ENLARGE_CONTEXT_SCALE))
  ? Number(process.env.ENLARGE_CONTEXT_SCALE)
  : 2;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)(\?|$)/i;

function looksLikeImageAttachment(attachment) {
  if (!attachment?.url) return false;
  const ct = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  const url = String(attachment.url || '').toLowerCase();
  if (ct.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(name) || IMAGE_EXT_RE.test(url);
}

function inferExtensionFromUrl(url, fallback = 'png') {
  if (!url) return fallback;
  const match = String(url).match(/\.([a-z0-9]+)(?:\?.*)?$/i);
  return match ? match[1].toLowerCase() : fallback;
}

function deriveBaseName(input, fallback = 'media') {
  if (!input) return fallback;
  try {
    const url = new URL(input);
    const pathname = url.pathname.split('/').filter(Boolean).pop();
    if (pathname) return pathname.split('.').shift() || fallback;
  } catch (_) {}
  const name = String(input).split('/').pop();
  if (name) return name.split('.').shift() || fallback;
  return fallback;
}

function pickOutputExtension(format) {
  const fmt = String(format || '').toLowerCase();
  if (fmt === 'gif') return 'gif';
  if (fmt === 'webp') return 'webp';
  if (fmt === 'jpeg' || fmt === 'jpg') return 'jpg';
  return 'png';
}

function resolveMediaSource(message) {
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const attachment of attachments) {
    if (!looksLikeImageAttachment(attachment)) continue;
    return {
      url: attachment.url,
      name: attachment.name || null,
    };
  }

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    const candidate = embed?.image?.url || embed?.thumbnail?.url || null;
    if (!candidate) continue;
    return {
      url: candidate,
      name: null,
    };
  }

  return null;
}

async function upscaleMedia(buffer, scale) {
  const image = sharp(buffer, { animated: true });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read the image dimensions.');
  }

  const targetWidth = Math.round(metadata.width * scale);
  const targetHeight = Math.round(metadata.height * scale);
  const width = Math.max(1, Math.min(targetWidth, MAX_DIMENSION));
  const height = Math.max(1, Math.min(targetHeight, MAX_DIMENSION));

  let pipeline = image.resize({ width, height, fit: 'inside', withoutEnlargement: false });
  let outputExt = pickOutputExtension(metadata.format);

  switch (outputExt) {
    case 'gif':
      pipeline = pipeline.gif({ reoptimise: false });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: 100 });
      break;
    case 'jpg':
      pipeline = pipeline.jpeg({ quality: 95, progressive: true });
      break;
    case 'png':
    default:
      pipeline = pipeline.png({ compressionLevel: 8 });
      outputExt = 'png';
      break;
  }

  const outBuffer = await pipeline.toBuffer();
  const capped = width !== targetWidth || height !== targetHeight;
  return { buffer: outBuffer, width, height, outputExt, capped, targetWidth, targetHeight };
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Enlarge')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const source = resolveMediaSource(interaction.targetMessage);
    if (!source?.url) {
      await interaction.reply({
        content: 'That message does not contain an image or GIF I can enlarge.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const input = Buffer.from(await response.arrayBuffer());
      if (!input.length) throw new Error('Downloaded file was empty.');
      if (input.length > MAX_MEDIA_BYTES) throw new Error('File is too large to enlarge (25 MB limit).');

      const { buffer, width, height, outputExt, capped, targetWidth, targetHeight } = await upscaleMedia(input, CONTEXT_SCALE);
      if (buffer.length > MAX_MEDIA_BYTES) {
        throw new Error('Upscaled file is too large to send (over 25 MB). Try a smaller scale.');
      }

      const baseName = source.name
        ? deriveBaseName(source.name)
        : deriveBaseName(source.url);
      const fileName = `${baseName || 'media'}-${CONTEXT_SCALE}x.${outputExt || inferExtensionFromUrl(source.url)}`;
      const file = new AttachmentBuilder(buffer, { name: fileName });

      const notes = [`Enlarged to ${width}x${height} (${CONTEXT_SCALE}x).`];
      if (capped) notes.push(`Requested ${targetWidth}x${targetHeight} but capped at ${MAX_DIMENSION}px edges.`);
      await interaction.editReply({ content: notes.join(' '), files: [file] });
    } catch (err) {
      const message = err?.message || 'Unknown error';
      await interaction.editReply({ content: `Could not enlarge that media: ${message}` });
    }
  },
};
