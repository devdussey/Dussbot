const {
  ApplicationIntegrationType,
  AttachmentBuilder,
  parseEmoji,
  SlashCommandBuilder,
} = require('discord.js');
const sharp = require('sharp');
const fetch = globalThis.fetch;

const MAX_DIMENSION = 8192;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

// ----- Unicode emoji helpers (Twemoji) -----
function cpArray(str) {
  const out = [];
  for (const ch of str) out.push(ch.codePointAt(0));
  return out;
}

function isPictographic(cp) {
  // Broad, pragmatic coverage for common emoji blocks
  return (
    (cp >= 0x1F000 && cp <= 0x1FAFF) || // Misc pictographs, Supplemental Symbols & Pictographs
    (cp >= 0x2300 && cp <= 0x27FF) ||   // Misc technical + dingbats + arrows, etc.
    (cp >= 0x2B00 && cp <= 0x2BFF) ||   // Misc symbols and arrows
    (cp >= 0x2600 && cp <= 0x26FF)      // Dingbats range
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
    // Optional VS
    if (j < cps.length && (cps[j] === VS15 || cps[j] === VS16)) {
      cluster.push(cps[j]);
      j++;
    }
    // Optional skin tone
    if (j < cps.length && cps[j] >= SKIN_START && cps[j] <= SKIN_END) {
      cluster.push(cps[j]);
      j++;
    }
    // Handle ZWJ sequences
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
  // Use Twemoji PNG assets (72x72). These upscale fine in Discord UI.
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
    } catch (_) {
      // continue
    }
  }
  return null;
}

function extractStickerMention(input) {
  if (!input) return null;
  const match = input.match(/^<(?:(a):)?([a-zA-Z0-9_]{2,32}):([0-9]{15,25})>$/);
  if (!match) return null;
  return { id: match[3], name: match[2], animated: Boolean(match[1]) };
}

function pickOutputExtension(format) {
  const fmt = (format || '').toLowerCase();
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

function deriveBaseName(input, fallback = 'media') {
  if (!input) return fallback;
  try {
    const url = new URL(input);
    const pathname = url.pathname.split('/').filter(Boolean).pop();
    if (pathname) return pathname.split('.').shift() || fallback;
  } catch (_) {
    // Not a URL, fall back to simple parsing
  }
  const name = input.split('/').pop();
  if (name) return name.split('.').shift() || fallback;
  return fallback;
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enlarge')
    .setDescription('Enlarge an emoji, sticker, or image and post it as an attachment')
    .setDMPermission(true)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
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
    ),

  async execute(interaction) {
    // Acknowledge immediately to avoid timeouts. If that fails, fall back to a channel message we can edit.
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
      } catch (_) {
        // ignore; we will try again later
      }
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'emoji') {
      const input = interaction.options.getString('input', true);
      const size = interaction.options.getInteger('size') ?? 512;
      let parsed = parseEmojiInput(input);
      // Allow Unicode emoji via Twemoji as a fallback
      let unicodeFallback = null;
      if (!parsed) {
        unicodeFallback = unicodeEmojiToTwemojiUrl(input);
      }
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
          // Try the opposite animation state in case the provided info was incomplete.
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
      } catch (err) {
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

      // Guess extension from URL if possible
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
        const baseName = attachmentInput?.name ? deriveBaseName(attachmentInput.name) : deriveBaseName(sourceUrl);
        const fileName = `${baseName || 'media'}-${scale}x.${outputExt}`;
        const attachment = new AttachmentBuilder(upscaled, { name: fileName });

        const parts = [
          `Enlarged to ${width}x${height} (${scale}x).`,
        ];
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
  },
};
