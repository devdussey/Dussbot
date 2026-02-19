const path = require('path');

const DEFAULT_MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const MIN_VALID_MEDIA_BYTES = 64;

function isLikelyExpiringDiscordUrl(parsedUrl) {
  if (!parsedUrl) return false;
  const host = String(parsedUrl.hostname || '').toLowerCase();
  if (!host.endsWith('discordapp.net') && !host.endsWith('discordapp.com')) return false;
  const hasExpiryParams = parsedUrl.searchParams.has('ex')
    || parsedUrl.searchParams.has('is')
    || parsedUrl.searchParams.has('hm')
    || parsedUrl.searchParams.has('expires')
    || parsedUrl.searchParams.has('signature');
  return hasExpiryParams;
}

function isSupportedMediaType(contentType) {
  const value = String(contentType || '').toLowerCase();
  if (!value) return false;
  return value.startsWith('image/') || value.startsWith('video/');
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

  let response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'follow' });
  } catch (_) {
    return null;
  }

  if (!response?.ok) return null;

  const contentType = response.headers.get('content-type') || '';
  if (!isSupportedMediaType(contentType)) return null;

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > maxBytes) return null;

  let buffer;
  try {
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (_) {
    return null;
  }

  if (!buffer || buffer.length < MIN_VALID_MEDIA_BYTES || buffer.length > maxBytes) {
    return null;
  }

  return {
    attachment: buffer,
    name: buildAttachmentName(url, contentType),
  };
}

module.exports = {
  fetchMediaAttachment,
  isLikelyExpiringDiscordUrl,
};
