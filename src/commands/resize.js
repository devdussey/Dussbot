const {
  ApplicationIntegrationType,
  AttachmentBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');
const sharp = require('sharp');

const fetch = globalThis.fetch;

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 8192;

const PERCENTAGE_CHOICES = new Set([25, 50, 100, 200]);
const PIXEL_PRESETS = new Map([
  ['64x64', { width: 64, height: 64 }],
  ['128x128', { width: 128, height: 128 }],
  ['256x256', { width: 256, height: 256 }],
  ['500x500', { width: 500, height: 500 }],
]);

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function pickOutputExtension(format) {
  const fmt = String(format || '').toLowerCase();
  if (fmt === 'gif') return 'gif';
  if (fmt === 'webp') return 'webp';
  if (fmt === 'jpeg' || fmt === 'jpg') return 'jpg';
  return 'png';
}

function deriveBaseName(input, fallback = 'image') {
  if (!input) return fallback;
  let raw = null;
  try {
    const url = new URL(input);
    raw = url.pathname.split('/').filter(Boolean).pop() || null;
  } catch (_) {
    raw = String(input).split('/').pop() || null;
  }
  const trimmed = raw ? raw.split('.').shift() : fallback;
  const safe = String(trimmed || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return safe || fallback;
}

function clampDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(Math.round(numeric), MAX_DIMENSION));
}

async function resizeImage(buffer, mode) {
  const image = sharp(buffer, { animated: true });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions.');
  }

  let requestedWidth = metadata.width;
  let requestedHeight = metadata.height;
  let modeLabel = '100%';

  if (mode.kind === 'pixels') {
    requestedWidth = mode.width;
    requestedHeight = mode.height;
    modeLabel = `${mode.width}x${mode.height}`;
  } else {
    const percent = PERCENTAGE_CHOICES.has(mode.percent) ? mode.percent : 100;
    requestedWidth = Math.round(metadata.width * (percent / 100));
    requestedHeight = Math.round(metadata.height * (percent / 100));
    modeLabel = `${percent}%`;
  }

  const width = clampDimension(requestedWidth);
  const height = clampDimension(requestedHeight);
  let outputExt = pickOutputExtension(metadata.format);

  let pipeline = image.resize({
    width,
    height,
    fit: 'fill',
    withoutEnlargement: false,
  });

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

  const output = await pipeline.toBuffer();
  return {
    buffer: output,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    width,
    height,
    requestedWidth,
    requestedHeight,
    outputExt,
    modeLabel,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resize')
    .setDescription('Resize an image by percentage or pixel preset')
    .setDMPermission(true)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Upload the image to resize')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('Direct image URL to resize')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('percentage')
        .setDescription('Resize by percentage')
        .addChoices(
          { name: '25%', value: '25' },
          { name: '50%', value: '50' },
          { name: '100%', value: '100' },
          { name: '200%', value: '200' },
        )
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('pixels')
        .setDescription('Resize to fixed pixels')
        .addChoices(
          { name: '64x64', value: '64x64' },
          { name: '128x128', value: '128x128' },
          { name: '256x256', value: '256x256' },
          { name: '500x500', value: '500x500' },
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const attachmentInput = interaction.options.getAttachment('image');
    const urlInput = interaction.options.getString('url');
    const sourceUrl = attachmentInput?.url || urlInput;

    if (!sourceUrl) {
      await interaction.editReply('Please upload an image or provide an image URL.');
      return;
    }

    if (!attachmentInput && !isHttpUrl(sourceUrl)) {
      await interaction.editReply('Please provide a valid http/https URL.');
      return;
    }

    if (attachmentInput?.contentType && !attachmentInput.contentType.startsWith('image/')) {
      await interaction.editReply('The uploaded file must be an image.');
      return;
    }

    const percentageRaw = interaction.options.getString('percentage');
    const pixelsRaw = interaction.options.getString('pixels');

    if (percentageRaw && pixelsRaw) {
      await interaction.editReply('Choose either `percentage` or `pixels`, not both.');
      return;
    }

    const percent = Number(percentageRaw || '100');
    const pixelPreset = pixelsRaw ? PIXEL_PRESETS.get(pixelsRaw) : null;
    if (pixelsRaw && !pixelPreset) {
      await interaction.editReply('Invalid pixel preset selected.');
      return;
    }

    const mode = pixelPreset
      ? { kind: 'pixels', width: pixelPreset.width, height: pixelPreset.height }
      : { kind: 'percentage', percent: PERCENTAGE_CHOICES.has(percent) ? percent : 100 };

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);

      const input = Buffer.from(await response.arrayBuffer());
      if (!input.length) throw new Error('Downloaded file was empty.');
      if (input.length > MAX_MEDIA_BYTES) {
        throw new Error('File is too large to process (25 MB limit).');
      }

      const result = await resizeImage(input, mode);
      if (result.buffer.length > MAX_MEDIA_BYTES) {
        throw new Error('Resized file is too large to send (over 25 MB).');
      }

      const baseName = attachmentInput?.name
        ? deriveBaseName(attachmentInput.name)
        : deriveBaseName(sourceUrl);
      const fileName = `${baseName || 'image'}-resized.${result.outputExt}`;
      const output = new AttachmentBuilder(result.buffer, { name: fileName });

      const lines = [
        `Resized to ${result.width}x${result.height} (${result.modeLabel}).`,
        `Original size was ${result.sourceWidth}x${result.sourceHeight}.`,
      ];

      if (result.width !== result.requestedWidth || result.height !== result.requestedHeight) {
        lines.push(`Requested ${result.requestedWidth}x${result.requestedHeight} but capped at ${MAX_DIMENSION}px edges.`);
      }

      await interaction.editReply({ content: lines.join(' '), files: [output] });
    } catch (err) {
      await interaction.editReply(`Could not resize that image: ${err.message}`);
    }
  },
};
