const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir, resolveDataPath } = require('./dataDir');

const MEDIA_DIR = 'autorespond-media';
const MEMORY_CACHE_LIMIT = 128;
const MEMORY_CACHE_TTL_MS = 10 * 60 * 1000;
const memoryCache = new Map();

function normalizeRelativePath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const normalized = path.posix.normalize(raw).replace(/^\/+/, '');
  if (!normalized.startsWith(`${MEDIA_DIR}/`)) return '';
  if (normalized.includes('..')) return '';
  return normalized.slice(0, 500);
}

function sanitizeStoredMediaPath(value) {
  return normalizeRelativePath(value);
}

function sanitizeStoredMediaName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const base = path.basename(raw);
  const safe = base.replace(/[^a-zA-Z0-9._()\- ]+/g, '_').trim();
  return safe.slice(0, 120);
}

function getStoredMediaAbsolutePath(storedPath) {
  const relativePath = normalizeRelativePath(storedPath);
  if (!relativePath) return '';
  return resolveDataPath(relativePath);
}

function pruneMemoryCache(now = Date.now()) {
  for (const [key, entry] of memoryCache.entries()) {
    if (now - entry.cachedAt > MEMORY_CACHE_TTL_MS) {
      memoryCache.delete(key);
    }
  }
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }
}

function setCachedMedia(storedPath, buffer) {
  const relativePath = normalizeRelativePath(storedPath);
  if (!relativePath || !Buffer.isBuffer(buffer) || !buffer.length) return;
  const now = Date.now();
  memoryCache.set(relativePath, { buffer, cachedAt: now });
  pruneMemoryCache(now);
}

function getCachedMedia(storedPath) {
  const relativePath = normalizeRelativePath(storedPath);
  if (!relativePath) return null;
  const entry = memoryCache.get(relativePath);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.cachedAt > MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(relativePath);
    return null;
  }
  return entry.buffer;
}

function getPreferredFileName(originalName, fallback = 'autorespond-media.bin') {
  const safe = sanitizeStoredMediaName(originalName);
  if (safe) return safe;
  return fallback;
}

function buildStoredFileName(ruleId, originalName, buffer) {
  const preferred = getPreferredFileName(originalName);
  const ext = path.extname(preferred).toLowerCase().slice(0, 10) || '.bin';
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
  const cleanRuleId = String(Number(ruleId) || 0);
  return `rule-${cleanRuleId}-${Date.now()}-${hash}${ext}`;
}

async function storeRuleMediaBuffer(guildId, ruleId, buffer, originalName) {
  if (!guildId || !ruleId || !Buffer.isBuffer(buffer) || !buffer.length) return null;
  const safeGuildId = String(guildId).replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 64) || 'guild';
  const fileName = buildStoredFileName(ruleId, originalName, buffer);
  const relativePath = path.posix.join(MEDIA_DIR, safeGuildId, fileName);
  const absolutePath = resolveDataPath(relativePath);
  await ensureDir(path.dirname(absolutePath));
  await fs.promises.writeFile(absolutePath, buffer);
  setCachedMedia(relativePath, buffer);
  return {
    mediaStoredPath: relativePath,
    mediaStoredName: getPreferredFileName(originalName, fileName),
  };
}

async function loadStoredMediaAttachment(rule) {
  const storedPath = sanitizeStoredMediaPath(rule?.mediaStoredPath || '');
  if (!storedPath) return null;
  const fileName = sanitizeStoredMediaName(rule?.mediaStoredName || '') || path.posix.basename(storedPath);
  const cached = getCachedMedia(storedPath);
  if (cached) {
    return {
      attachment: cached,
      name: fileName,
    };
  }

  const absolutePath = getStoredMediaAbsolutePath(storedPath);
  if (!absolutePath) return null;

  let buffer = null;
  try {
    buffer = await fs.promises.readFile(absolutePath);
  } catch (_) {
    return null;
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  setCachedMedia(storedPath, buffer);
  return {
    attachment: buffer,
    name: fileName,
  };
}

function deleteStoredMediaSync(storedPath) {
  const relativePath = normalizeRelativePath(storedPath);
  if (!relativePath) return false;
  memoryCache.delete(relativePath);
  const absolutePath = getStoredMediaAbsolutePath(relativePath);
  if (!absolutePath) return false;
  try {
    fs.unlinkSync(absolutePath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    return false;
  }
}

module.exports = {
  deleteStoredMediaSync,
  loadStoredMediaAttachment,
  sanitizeStoredMediaName,
  sanitizeStoredMediaPath,
  storeRuleMediaBuffer,
};
