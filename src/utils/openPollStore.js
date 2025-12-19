const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'openpolls.json';
const MAX_ANSWERS = 50;

function getDataFile() {
  return resolveDataPath(STORE_FILE);
}

let cache = null;

function sanitiseText(value, maxLen) {
  const str = String(value || '').trim();
  if (!str) return '';
  const oneLine = str.replace(/\s*\n+\s*/g, ' ');
  return oneLine.slice(0, maxLen);
}

function sanitiseAnswer(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const text = sanitiseText(answer.text, 200);
  if (!text) return null;
  return {
    text,
    authorId: String(answer.authorId || ''),
    createdAt: Number.isFinite(answer.createdAt) ? answer.createdAt : Date.now(),
  };
}

function sanitisePoll(poll) {
  if (!poll || typeof poll !== 'object') return null;
  const cleaned = { ...poll };
  cleaned.id = String(cleaned.id || '');
  cleaned.guildId = cleaned.guildId ? String(cleaned.guildId) : null;
  cleaned.channelId = cleaned.channelId ? String(cleaned.channelId) : null;
  cleaned.messageId = cleaned.messageId ? String(cleaned.messageId) : null;
  cleaned.creatorId = String(cleaned.creatorId || '');
  cleaned.question = sanitiseText(cleaned.question, 300);
  cleaned.open = cleaned.open !== false;
  cleaned.createdAt = Number.isFinite(cleaned.createdAt) ? cleaned.createdAt : Date.now();
  cleaned.updatedAt = Number.isFinite(cleaned.updatedAt) ? cleaned.updatedAt : cleaned.createdAt;
  const answers = Array.isArray(cleaned.answers) ? cleaned.answers : [];
  cleaned.answers = answers.map(sanitiseAnswer).filter(Boolean).slice(0, MAX_ANSWERS);
  const voteByUser = cleaned.voteByUser && typeof cleaned.voteByUser === 'object' ? cleaned.voteByUser : {};
  cleaned.voteByUser = {};
  for (const [userId, answerIdx] of Object.entries(voteByUser)) {
    const uid = String(userId || '').trim();
    const idx = Number(answerIdx);
    if (!uid) continue;
    if (!Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= cleaned.answers.length) continue;
    cleaned.voteByUser[uid] = idx;
  }
  return cleaned.id && cleaned.creatorId && cleaned.question ? cleaned : null;
}

function ensureLoaded() {
  if (cache) return;
  try {
    ensureFileSync(STORE_FILE, JSON.stringify({ guilds: {} }, null, 2));
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    cache = raw ? JSON.parse(raw) : { guilds: {} };
    if (!cache || typeof cache !== 'object') cache = { guilds: {} };
    if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
  } catch (err) {
    console.error('Failed to load open poll store:', err);
    cache = { guilds: {} };
  }
}

function persist() {
  const safe = cache && typeof cache === 'object' ? cache : { guilds: {} };
  writeJsonSync(STORE_FILE, safe);
}

function ensureGuild(guildId) {
  ensureLoaded();
  const id = String(guildId);
  if (!cache.guilds[id]) {
    cache.guilds[id] = { nextPollId: 1, polls: {} };
  }
  const guild = cache.guilds[id];
  if (!Number.isInteger(guild.nextPollId) || guild.nextPollId < 1) guild.nextPollId = 1;
  if (!guild.polls || typeof guild.polls !== 'object') guild.polls = {};
  return guild;
}

function createPoll(guildId, poll) {
  const guild = ensureGuild(guildId);
  const id = String(guild.nextPollId++);
  const stored = sanitisePoll({
    id,
    guildId: String(guildId),
    creatorId: poll?.creatorId,
    channelId: poll?.channelId || null,
    messageId: poll?.messageId || null,
    question: poll?.question,
    open: poll?.open !== false,
    answers: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!stored) throw new Error('Invalid poll payload');
  guild.polls[id] = stored;
  persist();
  return { ...stored, answers: stored.answers.slice() };
}

function removePoll(guildId, pollId) {
  const guild = ensureGuild(guildId);
  const key = String(pollId);
  if (!guild.polls[key]) return false;
  delete guild.polls[key];
  persist();
  return true;
}

function getPoll(guildId, pollId) {
  const guild = ensureGuild(guildId);
  const poll = guild.polls[String(pollId)];
  const cleaned = sanitisePoll(poll);
  return cleaned ? { ...cleaned, answers: cleaned.answers.slice() } : null;
}

function setPollMessage(guildId, pollId, channelId, messageId) {
  const guild = ensureGuild(guildId);
  const poll = guild.polls[String(pollId)];
  if (!poll) return null;
  poll.channelId = channelId ? String(channelId) : poll.channelId;
  poll.messageId = messageId ? String(messageId) : poll.messageId;
  poll.updatedAt = Date.now();
  guild.polls[String(pollId)] = sanitisePoll(poll) || poll;
  persist();
  return getPoll(guildId, pollId);
}

function togglePollOpen(guildId, pollId) {
  const guild = ensureGuild(guildId);
  const poll = guild.polls[String(pollId)];
  if (!poll) return null;
  poll.open = !poll.open;
  poll.updatedAt = Date.now();
  guild.polls[String(pollId)] = sanitisePoll(poll) || poll;
  persist();
  return getPoll(guildId, pollId);
}

function addAnswer(guildId, pollId, answer) {
  const guild = ensureGuild(guildId);
  const poll = guild.polls[String(pollId)];
  if (!poll) return { ok: false, error: 'not_found' };
  if (poll.open === false) return { ok: false, error: 'closed' };

  const cleanedAnswer = sanitiseAnswer(answer);
  if (!cleanedAnswer) return { ok: false, error: 'invalid_answer' };

  poll.answers = Array.isArray(poll.answers) ? poll.answers : [];
  if (poll.answers.length >= MAX_ANSWERS) return { ok: false, error: 'max_answers' };

  poll.answers.push(cleanedAnswer);
  poll.updatedAt = Date.now();
  guild.polls[String(pollId)] = sanitisePoll(poll) || poll;
  persist();
  return { ok: true, poll: getPoll(guildId, pollId) };
}

function toggleVote(guildId, pollId, userId, answerIndex) {
  const guild = ensureGuild(guildId);
  const poll = guild.polls[String(pollId)];
  if (!poll) return { ok: false, error: 'not_found' };
  if (poll.open === false) return { ok: false, error: 'closed' };

  const uid = String(userId || '').trim();
  const idx = Number(answerIndex);
  if (!uid) return { ok: false, error: 'invalid_user' };
  if (!Number.isInteger(idx)) return { ok: false, error: 'invalid_answer' };

  poll.answers = Array.isArray(poll.answers) ? poll.answers : [];
  if (idx < 0 || idx >= poll.answers.length) return { ok: false, error: 'invalid_answer' };

  poll.voteByUser = poll.voteByUser && typeof poll.voteByUser === 'object' ? poll.voteByUser : {};
  const current = Number.isInteger(poll.voteByUser[uid]) ? poll.voteByUser[uid] : null;

  let changed = false;
  let removed = false;
  if (current === idx) {
    delete poll.voteByUser[uid];
    changed = true;
    removed = true;
  } else {
    poll.voteByUser[uid] = idx;
    changed = true;
  }

  if (changed) {
    poll.updatedAt = Date.now();
    guild.polls[String(pollId)] = sanitisePoll(poll) || poll;
    persist();
  }

  return { ok: true, poll: getPoll(guildId, pollId), changed, removed };
}

function clearVote(guildId, pollId, userId) {
  const guild = ensureGuild(guildId);
  const poll = guild.polls[String(pollId)];
  if (!poll) return { ok: false, error: 'not_found' };
  if (poll.open === false) return { ok: false, error: 'closed' };

  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, error: 'invalid_user' };

  poll.voteByUser = poll.voteByUser && typeof poll.voteByUser === 'object' ? poll.voteByUser : {};
  const had = Object.prototype.hasOwnProperty.call(poll.voteByUser, uid);
  if (had) delete poll.voteByUser[uid];

  if (had) {
    poll.updatedAt = Date.now();
    guild.polls[String(pollId)] = sanitisePoll(poll) || poll;
    persist();
  }

  return { ok: true, poll: getPoll(guildId, pollId), changed: had };
}

module.exports = {
  MAX_ANSWERS,
  createPoll,
  removePoll,
  getPoll,
  setPollMessage,
  togglePollOpen,
  addAnswer,
  toggleVote,
  clearVote,
};
