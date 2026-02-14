const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const fetch = globalThis.fetch;

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)(\?|$)/i;

const EDIT_LOAD = 'load';
const IMAGE_FILTER_EDIT_CHOICES = [
  { name: 'Load', value: EDIT_LOAD },
];

const BUNDLED_FILTER_PATHS = new Map([
  [EDIT_LOAD, path.join(__dirname, '..', 'assets', 'imagefilters', 'load.gif')],
]);

const FALLBACK_FILTER_URLS = new Map([
  [EDIT_LOAD, 'https://i.gifer.com/ZZ5H.gif'],
]);

const filterBufferCache = new Map();
const STABLE_GIF_OUTPUT_OPTIONS = Object.freeze({
  reoptimise: false,
  colours: 256,
  dither: 0,
  effort: 10,
  interFrameMaxError: 0,
  interPaletteMaxError: 0,
});

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function clampDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(Math.round(numeric), MAX_DIMENSION));
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

function looksLikeImageAttachment(attachment) {
  if (!attachment?.url) return false;
  const contentType = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  const url = String(attachment.url || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  return IMAGE_FILE_RE.test(name) || IMAGE_FILE_RE.test(url);
}

function resolveMessageImageSource(message) {
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const attachment of attachments) {
    if (!looksLikeImageAttachment(attachment)) continue;
    return {
      url: attachment.url,
      name: attachment.name || null,
      size: typeof attachment.size === 'number' ? attachment.size : null,
      contentType: attachment.contentType || null,
    };
  }

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    const url = embed?.image?.url || embed?.thumbnail?.url || null;
    if (!url) continue;
    if (!isHttpUrl(url)) continue;
    return {
      url,
      name: null,
      size: null,
      contentType: null,
    };
  }

  return null;
}

function assertSupportedEdit(edit) {
  if (!IMAGE_FILTER_EDIT_CHOICES.some(choice => choice.value === edit)) {
    throw new Error('Unsupported edit selected.');
  }
}

async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error('Downloaded file was empty.');
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error('File is too large to process (25 MB limit).');
  }
  return buffer;
}

async function getBundledFilterBuffer(edit) {
  if (filterBufferCache.has(edit)) {
    return filterBufferCache.get(edit);
  }

  const envPath = edit === EDIT_LOAD ? String(process.env.IMAGEFILTER_LOAD_GIF_PATH || '').trim() : '';
  const bundledPath = BUNDLED_FILTER_PATHS.get(edit);
  const sourcePath = envPath || bundledPath;

  if (sourcePath) {
    try {
      const fileBuffer = await fs.readFile(sourcePath);
      filterBufferCache.set(edit, fileBuffer);
      return fileBuffer;
    } catch (_) {
      // Fall through to remote fallback.
    }
  }

  const fallbackUrl = FALLBACK_FILTER_URLS.get(edit);
  if (!fallbackUrl) {
    throw new Error('No filter source configured for this edit.');
  }

  const remoteBuffer = await downloadBuffer(fallbackUrl);
  filterBufferCache.set(edit, remoteBuffer);
  return remoteBuffer;
}

async function applyImageFilter(inputBuffer, edit) {
  assertSupportedEdit(edit);
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Input image was empty.');
  }

  const sourceMetadata = await sharp(inputBuffer, { animated: true }).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error('Could not read image dimensions.');
  }

  const width = clampDimension(sourceMetadata.width);
  const height = clampDimension(sourceMetadata.height);

  const baseStillImage = await sharp(inputBuffer)
    .resize({
      width,
      height,
      fit: 'cover',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  const filterBuffer = await getBundledFilterBuffer(edit);
  const resizedFilterGif = await sharp(filterBuffer, { animated: true })
    .resize({
      width,
      height,
      fit: 'cover',
      withoutEnlargement: false,
    })
    .gif(STABLE_GIF_OUTPUT_OPTIONS)
    .toBuffer();

  const filterMetadata = await sharp(resizedFilterGif, { animated: true }).metadata();
  const frameCount = Math.max(1, Number(filterMetadata.pages) || 1);
  const delay = Array.isArray(filterMetadata.delay) && filterMetadata.delay.length
    ? filterMetadata.delay
    : Array(frameCount).fill(60);

  // Build an animated base with the same frame count so the background remains stable.
  const animatedBase = await sharp({
    create: {
      width,
      height: height * frameCount,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      Array.from({ length: frameCount }, (_, idx) => ({
        input: baseStillImage,
        left: 0,
        top: idx * height,
      }))
    )
    .gif({
      ...STABLE_GIF_OUTPUT_OPTIONS,
      delay,
      loop: Number.isFinite(filterMetadata.loop) ? filterMetadata.loop : 0,
      pageHeight: height,
    })
    .toBuffer();

  // Keep the background static and let the moving filter effect render on top.
  const blendMode = filterMetadata.hasAlpha ? 'over' : 'lighten';
  const outputBuffer = await sharp(animatedBase, { animated: true })
    .composite([{ input: resizedFilterGif, blend: blendMode }])
    .gif({
      ...STABLE_GIF_OUTPUT_OPTIONS,
      delay,
      loop: Number.isFinite(filterMetadata.loop) ? filterMetadata.loop : 0,
    })
    .toBuffer();

  if (outputBuffer.length > MAX_MEDIA_BYTES) {
    throw new Error('Filtered image is too large to send (over 25 MB).');
  }

  return {
    buffer: outputBuffer,
    width,
    height,
    outputExt: 'gif',
  };
}

module.exports = {
  MAX_MEDIA_BYTES,
  IMAGE_FILTER_EDIT_CHOICES,
  applyImageFilter,
  deriveBaseName,
  downloadBuffer,
  isHttpUrl,
  resolveMessageImageSource,
};
