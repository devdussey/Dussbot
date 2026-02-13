const fs = require('fs/promises');
const { ensureFile, resolveDataPath, writeJson } = require('./dataDir');

const STORE_FILE = 'automessage.json';

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;
let loadPromise = null;
let saveTimeout = null;

async function ensureLoaded() {
  if (cache) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      await ensureFile(STORE_FILE, '{}');
      const raw = await fs.readFile(getDataFile(), 'utf8').catch(err => {
        if (err.code === 'ENOENT') return '{}';
        throw err;
      });
      cache = JSON.parse(raw || '{}');
    } catch (err) {
      console.error('Failed to load automessage store:', err);
      cache = {};
    } finally {
      loadPromise = null;
    }
  })();
  await loadPromise;
}

function schedulePersist() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    try {
      const safe = cache && typeof cache === 'object' ? cache : {};
      await writeJson(STORE_FILE, safe);
    } catch (err) {
      console.error('Failed to persist automessage store:', err);
    }
  }, 100);
}

function getGuildSync(guildId) {
  if (!cache[guildId]) {
    cache[guildId] = { nextId: 1, jobs: [] };
    schedulePersist();
  }
  const cfg = cache[guildId];
  if (!cfg.nextId || typeof cfg.nextId !== 'number') cfg.nextId = 1;
  if (!Array.isArray(cfg.jobs)) cfg.jobs = [];
  return cfg;
}

async function getGuild(guildId) {
  await ensureLoaded();
  return getGuildSync(guildId);
}

function sanitizeEmbed(embed) {
  if (!embed) return null;
  const clean = {};
  if (embed.title) clean.title = String(embed.title).slice(0, 256);
  if (embed.description) clean.description = String(embed.description).slice(0, 4000);
  if (embed.footer) clean.footer = { text: String(embed.footer.text || embed.footer).slice(0, 2048) };
  if (embed.image?.url || embed.image) {
    const rawUrl = String(embed.image?.url || embed.image).trim();
    try {
      const parsed = new URL(rawUrl);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        clean.image = { url: parsed.toString() };
      }
    } catch (_) {}
  }
  if (typeof embed.color === 'number' && Number.isFinite(embed.color)) {
    const clamped = Math.max(0, Math.min(0xFFFFFF, embed.color));
    clean.color = clamped;
  }
  return Object.keys(clean).length ? clean : null;
}

async function listJobs(guildId) {
  const cfg = await getGuild(guildId);
  return cfg.jobs.slice();
}

async function getJob(guildId, id) {
  const cfg = await getGuild(guildId);
  return cfg.jobs.find(j => j.id === Number(id)) || null;
}

async function addJob(guildId, { channelId, content, embed, intervalMs }) {
  const cfg = await getGuild(guildId);
  const id = cfg.nextId++;
  const job = {
    id,
    channelId,
    content: content ? String(content).slice(0, 2000) : '',
    embed: sanitizeEmbed(embed),
    intervalMs: Math.max(3_600_000, Number(intervalMs) || 3_600_000),
    enabled: true,
  };
  cfg.jobs.push(job);
  schedulePersist();
  return job;
}

async function removeJob(guildId, id) {
  const cfg = await getGuild(guildId);
  const before = cfg.jobs.length;
  cfg.jobs = cfg.jobs.filter(j => j.id !== Number(id));
  const removed = cfg.jobs.length !== before;
  if (removed) schedulePersist();
  return removed;
}

async function setEnabled(guildId, id, enabled) {
  const cfg = await getGuild(guildId);
  const job = cfg.jobs.find(j => j.id === Number(id));
  if (!job) return null;
  job.enabled = !!enabled;
  schedulePersist();
  return job;
}

module.exports = {
  addJob,
  getJob,
  getGuild,
  listJobs,
  removeJob,
  setEnabled,
};
