const { ChannelType } = require('discord.js');
const store = require('./autoMessageStore');

const timers = new Map(); // key: `${guildId}:${jobId}` -> Interval handle

function key(guildId, jobId) {
  return `${guildId}:${jobId}`;
}

function stopJob(guildId, jobId) {
  const k = key(guildId, jobId);
  const timer = timers.get(k);
  if (timer) {
    clearInterval(timer);
    timers.delete(k);
  }
}

async function runJob(client, guildId, job) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  let channel = guild.channels.cache.get(job.channelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(job.channelId);
    } catch (_) {
      channel = null;
    }
  }
  if (!channel || !channel.isTextBased() || channel.type === ChannelType.GuildVoice) return;

  const payload = { allowedMentions: { parse: [] } };
  if (job.content) payload.content = job.content;
  if (job.embed) payload.embeds = [job.embed];

  // Nothing to send; avoid API errors
  if (!payload.content && (!payload.embeds || !payload.embeds.length)) return;

  try {
    await channel.send(payload);
  } catch (err) {
    console.warn(`Automessage send failed for ${guildId}/${job.id}:`, err?.message || err);
  }
}

async function startJob(client, guildId, job) {
  const data = job || await store.getJob(guildId, job?.id);
  if (!data || !data.enabled) return;
  stopJob(guildId, data.id);
  const interval = Math.max(3_600_000, Number(data.intervalMs) || 3_600_000);
  const k = key(guildId, data.id);
  const handle = setInterval(() => {
    runJob(client, guildId, data);
  }, interval);
  timers.set(k, handle);
}

async function reloadGuild(client, guildId) {
  for (const timerKey of Array.from(timers.keys())) {
    if (timerKey.startsWith(`${guildId}:`)) {
      clearInterval(timers.get(timerKey));
      timers.delete(timerKey);
    }
  }
  const jobs = await store.listJobs(guildId);
  for (const job of jobs) {
    if (job.enabled) {
      startJob(client, guildId, job);
    }
  }
}

async function startAll(client) {
  const guildIds = Array.from(client.guilds.cache.keys());
  for (const gid of guildIds) {
    // eslint-disable-next-line no-await-in-loop
    await reloadGuild(client, gid);
  }
}

module.exports = {
  startAll,
  startJob,
  stopJob,
  reloadGuild,
};
