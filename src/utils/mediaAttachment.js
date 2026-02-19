const path = require('path');

const DEFAULT_MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const MIN_VALID_MEDIA_BYTES = 64;
const DISCORD_EXPIRY_QUERY_KEYS = new Set(['ex', 'is', 'hm', 'expires', 'signature']);
const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.mp4',
  '.mov',
  '.webm',
  '.avi',
  '.mkv',
]);

function isDiscordHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host.endsWith('discordapp.net') || host.endsWith('discordapp.com');
}

function isDiscordAttachmentPath(pathname) {
  const value = String(pathname || '').toLowerCase();
  return value.startsWith('/attachments/') || value.startsWith('/ephemeral-attachments/');
}

function hasExpiringDiscordParams(searchParams) {
  if (!searchParams) return false;
  for (const key of DISCORD_EXPIRY_QUERY_KEYS) {
    if (searchParams.has(key)) return true;
  }
  return false;
}

function normalizeDiscordAttachmentUrl(parsedUrl) {
  if (!parsedUrl || !isDiscordHost(parsedUrl.hostname) || !isDiscordAttachmentPath(parsedUrl.pathname)) {
    return null;
  }

  const normalized = new URL(parsedUrl.toString());
  if (normalized.hostname.toLowerCase() === 'media.discordapp.net') {
    normalized.hostname = 'cdn.discordapp.com';
  }

  if (hasExpiringDiscordParams(normalized.searchParams)) {
    normalized.search = '';
  }

  return normalized.toString();
}

function normalizeMediaUrlForStorage(mediaUrl) {
  const url = String(mediaUrl || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return normalizeDiscordAttachmentUrl(parsed) || url;
  } catch (_) {
    return url;
  }
}

function isLikelyExpiringDiscordUrl(parsedUrl) {
  if (!parsedUrl) return false;
  if (!isDiscordHost(parsedUrl.hostname)) return false;
  return hasExpiringDiscordParams(parsedUrl.searchParams);
}

function hasSupportedMediaExtension(mediaUrl) {
  try {
    const parsed = new URL(String(mediaUrl || '').trim());
    const ext = path.extname(parsed.pathname || '').toLowerCase();
    return SUPPORTED_MEDIA_EXTENSIONS.has(ext);
  } catch (_) {
    return false;
  }
}

function isSupportedMediaType(contentType, mediaUrl) {
  const value = String(contentType || '').toLowerCase();
  if (value.startsWith('image/') || value.startsWith('video/')) return true;
  return hasSupportedMediaExtension(mediaUrl);
}

function buildAttachmentName(url, contentType) {
  const mediaType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const extFromType = mediaType.includes('/') ? mediaType.split('/')[1] : '';

  try {
    const parsed = new URL(String(url || ''));
    const rawName = path.basename(parsed.pathname || '').trim();
    if (rawName) {
      if (path.extname(rawName)) return rawName.slice(0, 120);
      if (extFromType) return `${rawName.slice(0, 90)}.${extFromType}`;
      return rawName.slice(0, 120);
    }
  } catch (_) {}

  return `autorespond-media.${extFromType || 'bin'}`;
}

async function fetchMediaAttachment(mediaUrl, options = {}) {
  const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_MEDIA_BYTES;
  const url = String(mediaUrl || '').trim();
  if (!url) return null;

  const normalized = normalizeMediaUrlForStorage(url);
  const candidates = [...new Set([url, normalized].filter(Boolean))];

  for (const candidateUrl of candidates) {
    let response;
    try {
      response = await fetch(candidateUrl, { method: 'GET', redirect: 'follow' });
    } catch (_) {
      continue;
    }

    if (!response?.ok) continue;

    const contentType = response.headers.get('content-type') || '';
    if (!isSupportedMediaType(contentType, candidateUrl)) continue;

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > maxBytes) continue;

    let buffer;
    try {
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (_) {
      continue;
    }

    if (!buffer || buffer.length < MIN_VALID_MEDIA_BYTES || buffer.length > maxBytes) {
      continue;
    }

    return {
      attachment: buffer,
      name: buildAttachmentName(candidateUrl, contentType),
    };
  }

  return null;
}

module.exports = {
  fetchMediaAttachment,
  isLikelyExpiringDiscordUrl,
  normalizeMediaUrlForStorage,
};
