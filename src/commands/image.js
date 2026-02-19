const {
  ApplicationIntegrationType,
  AttachmentBuilder,
  InteractionContextType,
  PermissionsBitField,
  SlashCommandBuilder,
  parseEmoji,
} = require('discord.js');
const sharp = require('sharp');

const fetch = globalThis.fetch;
const premiumManager = require('../utils/premiumManager');
const removeBgUsageStore = require('../utils/removeBgUsageStore');

const MAX_DIMENSION = 8192;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const DAILY_FREE_LIMIT = 1;
const MAX_GIF_SIZE_BYTES = Number(process.env.REMOVE_BG_GIF_MAX_BYTES || 8 * 1024 * 1024);

const PERCENTAGE_CHOICES = new Set([25, 50, 100, 200]);
const PIXEL_PRESETS = new Map([
  ['64x64', { width: 64, height: 64 }],
  ['128x128', { width: 128, height: 128 }],
  ['256x256', { width: 256, height: 256 }],
  ['500x500', { width: 500, height: 500 }],
]);

function cpArray(str) {
  const out = [];
  for (const ch of str) out.push(ch.codePointAt(0));
  return out;
}

function isPictographic(cp) {
  return (
    (cp >= 0x1F000 && cp <= 0x1FAFF) ||
    (cp >= 0x2300 && cp <= 0x27FF) ||
    (cp >= 0x2B00 && cp <= 0x2BFF) ||
    (cp >= 0x2600 && cp <= 0x26FF)
  );
}

function extractFirstEmojiCluster(input) {
  if (!input) return null;
  const cps = cpArray(input.trim());
  const VS15 = 0xFE0E;
  const VS16 = 0xFE0F;
  const ZWJ = 0x200D;
  const SKIN_START = 0x1F3FB;
  const SKIN_END = 0x1F3FF;

  for (let i = 0; i < cps.length; i++) {
    if (!isPictographic(cps[i])) continue;
    const cluster = [cps[i]];
    let j = i + 1;
    if (j < cps.length && (cps[j] === VS15 || cps[j] === VS16)) {
      cluster.push(cps[j]);
      j++;
    }
    if (j < cps.length && cps[j] >= SKIN_START && cps[j] <= SKIN_END) {
      cluster.push(cps[j]);
      j++;
    }
    while (j < cps.length && cps[j] === ZWJ) {
      cluster.push(ZWJ);
      j++;
      if (j >= cps.length) break;
      if (!isPictographic(cps[j])) break;
      cluster.push(cps[j]);
      j++;
      if (j < cps.length && (cps[j] === VS15 || cps[j] === VS16)) {
        cluster.push(cps[j]);
        j++;
      }
      if (j < cps.length && cps[j] >= SKIN_START && cps[j] <= SKIN_END) {
        cluster.push(cps[j]);
        j++;
      }
    }
    return cluster;
  }
  return null;
}

function codePointsToTwemojiHex(cpList) {
  return cpList.map(cp => cp.toString(16)).join('-');
}

function unicodeEmojiToTwemojiUrl(input) {
  const cluster = extractFirstEmojiCluster(input);
  if (!cluster) return null;
  const hex = codePointsToTwemojiHex(cluster);
  return { url: `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${hex}.png`, name: `${hex}.png` };
}

function parseEmojiInput(input) {
  if (!input) return null;
  const parsed = parseEmoji(input);
  if (parsed?.id) {
    return { id: parsed.id, name: parsed.name, animated: Boolean(parsed.animated), explicitUrl: null };
  }

  const urlMatch = input.match(/https?:\/\/(?:media\.|cdn\.)?discord(?:app)?\.com\/emojis\/([0-9]{15,25})\.(png|webp|gif)/i);
  if (urlMatch) {
    const ext = urlMatch[2].toLowerCase();
    return { id: urlMatch[1], name: undefined, animated: ext === 'gif', explicitUrl: urlMatch[0] };
  }

  const idMatch = input.match(/^([0-9]{15,25})$/);
  if (idMatch) return { id: idMatch[1], name: undefined, animated: false, explicitUrl: null };
  return null;
}

function emojiCdnUrl(id, animated, size = 512) {
  const ext = animated ? 'gif' : 'png';
  const clamped = [16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 288, 320, 384, 448, 512, 576, 640, 768, 896, 1024, 1280, 1536, 1792, 2048, 4096]
    .reduce((prev, curr) => (Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev), 512);
  return `https://cdn.discordapp.com/emojis/${id}.${ext}?size=${clamped}&quality=lossless`;
}

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

function inferExtensionFromUrl(url, fallback = 'png') {
  if (!url) return fallback;
  const match = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
  if (match) return match[1].toLowerCase();
  return fallback;
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

function extractStickerMention(input) {
  if (!input) return null;
  const match = input.match(/^<(?:(a):)?([a-zA-Z0-9_]{2,32}):([0-9]{15,25})>$/);
  if (!match) return null;
  return { id: match[3], name: match[2], animated: Boolean(match[1]) };
}

function clampDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(Math.round(numeric), MAX_DIMENSION));
}

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

async function fetchStickerBufferByIdOrUrl(idOrUrl) {
  const tryUrls = [];
  if (/^[0-9]{15,25}$/.test(idOrUrl)) {
    for (const ext of ['png', 'apng', 'gif', 'json']) {
      tryUrls.push(`https://cdn.discordapp.com/stickers/${idOrUrl}.${ext}`);
    }
  } else if (/^https?:\/\//i.test(idOrUrl)) {
    tryUrls.push(idOrUrl);
  } else {
    return null;
  }

  for (const url of tryUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf && buf.length > 0) return { buffer: buf, sourceUrl: url };
      }
    } catch (_) {}
  }
  return null;
}

async function upscaleMedia(buffer, scale) {
  const image = sharp(buffer, { animated: true });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read the image dimensions');
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

async function handleRemoveBgImage(interaction) {
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

async function handleRemoveBgGif(interaction) {
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
  const attachment = new AttachmentBuilder(buffer, { name: 'no-bg.png' });
  await interaction.editReply({ content: 'GIF processed (output is a PNG without the background):', files: [attachment] });
}

function requireAdminInGuild(interaction) {
  if (!interaction.inGuild()) return 'Use this command in a server.';
  const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  if (!isAdmin) return 'Administrator permission is required to use this command.';
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Image tools: enlarge, resize, and remove background')
    .setDMPermission(true)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addSubcommandGroup(group =>
      group
        .setName('enlarge')
        .setDescription('Enlarge an emoji, sticker, or image')
        .addSubcommand(sub =>
          sub
            .setName('emoji')
            .setDescription('Enlarge a custom emoji by mention, ID, or URL')
            .addStringOption(opt =>
              opt.setName('input').setDescription('Emoji <:name:id>, ID, or CDN/emoji URL').setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName('size')
                .setDescription('Output size (for emojis)')
                .addChoices(
                  { name: '128', value: 128 },
                  { name: '256', value: 256 },
                  { name: '512', value: 512 },
                  { name: '1024', value: 1024 },
                  { name: '2048', value: 2048 },
                  { name: '4096', value: 4096 },
                )
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('sticker')
            .setDescription('Enlarge a sticker by ID, URL, or file')
            .addStringOption(opt =>
              opt.setName('id_or_url').setDescription('Sticker ID, mention, or CDN URL').setRequired(false)
            )
            .addAttachmentOption(opt =>
              opt.setName('file').setDescription('Sticker file (PNG/APNG/JSON)').setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('media')
            .setDescription('Enlarge an image or GIF by 2x, 4x, or 8x')
            .addAttachmentOption(opt =>
              opt.setName('file').setDescription('Image or GIF attachment').setRequired(false)
            )
            .addStringOption(opt =>
              opt.setName('url').setDescription('Direct image/GIF link or media CDN URL').setRequired(false)
            )
            .addIntegerOption(opt =>
              opt.setName('scale')
                .setDescription('Upscale factor')
                .addChoices(
                  { name: '2x', value: 2 },
                  { name: '4x', value: 4 },
                  { name: '8x', value: 8 },
                )
                .setRequired(false)
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('resize')
        .setDescription('Resize an image by percentage or pixel preset')
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
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('removebg')
        .setDescription('Remove the background from an image or GIF')
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
        )
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'enlarge') {
      const denial = requireAdminInGuild(interaction);
      if (denial) {
        await interaction.reply({ content: denial, ephemeral: true });
        return;
      }

      let acknowledged = false;
      let channelMsg = null;
      try {
        await interaction.reply({ content: 'Fetching media…' });
        acknowledged = true;
      } catch (_) {
        try {
          if (interaction.channel?.send) {
            channelMsg = await interaction.channel.send('Fetching media…');
          }
        } catch (_) {}
      }

      if (sub === 'emoji') {
        const input = interaction.options.getString('input', true);
        const size = interaction.options.getInteger('size') ?? 512;
        const parsed = parseEmojiInput(input);
        const unicodeFallback = parsed ? null : unicodeEmojiToTwemojiUrl(input);
        if (!parsed && !unicodeFallback) {
          const msg = 'Provide a custom emoji mention like <:name:id>, an emoji ID, a copied emoji link, or a Unicode emoji.';
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }

        let url = unicodeFallback ? unicodeFallback.url : (parsed.explicitUrl || emojiCdnUrl(parsed.id, parsed.animated, size));
        let fileName = unicodeFallback ? unicodeFallback.name : `${parsed.name || parsed.id}.${parsed.animated ? 'gif' : 'png'}`;

        try {
          let res = await fetch(url);
          if (!res.ok && !unicodeFallback && parsed?.id) {
            const altAnimated = !parsed.animated;
            const altUrl = emojiCdnUrl(parsed.id, altAnimated, size);
            const altRes = await fetch(altUrl);
            if (altRes.ok) {
              res = altRes;
              url = altUrl;
              fileName = `${parsed.name || parsed.id}.${altAnimated ? 'gif' : 'png'}`;
            }
          }
          if (!res.ok) throw new Error('Download failed');
          const buf = Buffer.from(await res.arrayBuffer());
          const attachment = new AttachmentBuilder(buf, { name: fileName });
          if (acknowledged) return interaction.editReply({ content: 'Here is the enlarged emoji.', files: [attachment] });
          if (channelMsg) return channelMsg.edit({ content: 'Here is the enlarged emoji.', files: [attachment] });
          return;
        } catch (_) {
          const msg = `Failed to fetch emoji image. URL: ${url}`;
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }
      }

      if (sub === 'sticker') {
        const rawIdOrUrl = interaction.options.getString('id_or_url');
        const mention = extractStickerMention(rawIdOrUrl);
        const idOrUrl = mention?.id || rawIdOrUrl;
        const file = interaction.options.getAttachment('file');

        let buffer = null;
        let urlUsed = null;
        try {
          if (file?.url) {
            const res = await fetch(file.url);
            if (!res.ok) throw new Error('Download failed');
            buffer = Buffer.from(await res.arrayBuffer());
            urlUsed = file.url;
          } else if (idOrUrl) {
            const result = await fetchStickerBufferByIdOrUrl(idOrUrl);
            if (!result) throw new Error('Could not resolve that sticker');
            buffer = result.buffer;
            urlUsed = result.sourceUrl;
          } else {
            const msg = 'Provide a sticker mention/ID/link or attach a sticker file.';
            if (acknowledged) return interaction.editReply({ content: msg });
            if (channelMsg) return channelMsg.edit(msg);
            return;
          }
        } catch (err) {
          const msg = `Failed to fetch sticker: ${err.message}`;
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }

        const guessedExt = inferExtensionFromUrl(urlUsed, 'png');
        const attachment = new AttachmentBuilder(buffer, { name: `sticker.${guessedExt}` });
        const responseContent = 'Here is the enlarged sticker.';
        if (acknowledged) return interaction.editReply({ content: responseContent, files: [attachment] });
        if (channelMsg) return channelMsg.edit({ content: responseContent, files: [attachment] });
        return;
      }

      if (sub === 'media') {
        const attachmentInput = interaction.options.getAttachment('file');
        const urlInput = interaction.options.getString('url');
        const chosenScale = interaction.options.getInteger('scale') ?? 2;
        const scale = [2, 4, 8].includes(chosenScale) ? chosenScale : 2;

        const sourceUrl = attachmentInput?.url || urlInput;
        if (!sourceUrl) {
          const msg = 'Attach an image/GIF or provide a direct link to enlarge.';
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }

        if (!attachmentInput && !/^https?:\/\//i.test(sourceUrl)) {
          const msg = 'Please provide a valid http/https URL for the media.';
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }

        if (attachmentInput?.contentType && !attachmentInput.contentType.startsWith('image/')) {
          const msg = 'Please attach an image or GIF file.';
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }

        try {
          const res = await fetch(sourceUrl);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          const arrayBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          if (!buf.length) throw new Error('Downloaded file was empty');
          if (buf.length > MAX_MEDIA_BYTES) throw new Error('File is too large to enlarge (25 MB limit).');

          const { buffer: upscaled, width, height, outputExt, capped, targetWidth, targetHeight } = await upscaleMedia(buf, scale);
          if (upscaled.length > MAX_MEDIA_BYTES) {
            throw new Error('Upscaled file is too large to send (over 25 MB). Try a smaller scale.');
          }
          const baseName = attachmentInput?.name ? deriveBaseName(attachmentInput.name, 'media') : deriveBaseName(sourceUrl, 'media');
          const fileName = `${baseName || 'media'}-${scale}x.${outputExt}`;
          const attachment = new AttachmentBuilder(upscaled, { name: fileName });

          const parts = [`Enlarged to ${width}x${height} (${scale}x).`];
          if (capped) parts.push(`Requested ${targetWidth}x${targetHeight} but capped at ${MAX_DIMENSION}px edges.`);

          const content = parts.join(' ');
          if (acknowledged) return interaction.editReply({ content, files: [attachment] });
          if (channelMsg) return channelMsg.edit({ content, files: [attachment] });
          return;
        } catch (err) {
          const msg = `Could not enlarge that media: ${err.message}`;
          if (acknowledged) return interaction.editReply({ content: msg });
          if (channelMsg) return channelMsg.edit(msg);
          return;
        }
      }

      const fallback = 'Unknown subcommand.';
      if (acknowledged) return interaction.editReply({ content: fallback });
      if (channelMsg) return channelMsg.edit(fallback);
      return;
    }

    if (group === 'removebg') {
      const denial = requireAdminInGuild(interaction);
      if (denial) {
        await interaction.reply({ content: denial, ephemeral: true });
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

      await interaction.deferReply();
      try { console.log(`[removebg] invoked by ${interaction.user?.id} in ${interaction.guild?.id} sub=${sub}`); } catch (_) {}

      try {
        if (sub === 'gif') {
          await handleRemoveBgGif(interaction);
        } else {
          await handleRemoveBgImage(interaction);
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
      return;
    }

    if (sub === 'resize') {
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
      return;
    }

    await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
