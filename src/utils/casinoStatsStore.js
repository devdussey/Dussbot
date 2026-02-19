const { ensureFileSync, readJsonSync, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'casinoStats.json';
const DEFAULT_STORE = { guilds: {} };

let cache = null;

function toWholeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function normalizeTopPayout(value) {
  if (!value || typeof value !== 'object') {
    return { userId: null, amount: 0 };
  }
  return {
    userId: typeof value.userId === 'string' ? value.userId : null,
    amount: toWholeNumber(value.amount),
  };
}

function normalizeWinLossRecord(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    wins: toWholeNumber(raw.wins),
    losses: toWholeNumber(raw.losses),
  };
}

function normalizeGameRecordMap(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const [game, record] of Object.entries(raw)) {
    if (!game) continue;
    out[game] = normalizeWinLossRecord(record);
  }
  return out;
}

function normalizeUserStats(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    totalWon: toWholeNumber(raw.totalWon),
    totalLost: toWholeNumber(raw.totalLost),
    totalBet: toWholeNumber(raw.totalBet),
    totalPayout: toWholeNumber(raw.totalPayout),
    games: normalizeGameRecordMap(raw.games),
  };
}

function normalizeGameStats(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    totalPaidOut: toWholeNumber(raw.totalPaidOut),
    rounds: toWholeNumber(raw.rounds),
    topPayout: normalizeTopPayout(raw.topPayout),
  };
}

function ensureLoaded() {
  if (cache) return;
  ensureFileSync(STORE_FILE, DEFAULT_STORE);
  const parsed = readJsonSync(STORE_FILE, DEFAULT_STORE);
  if (!parsed || typeof parsed !== 'object') {
    cache = { ...DEFAULT_STORE };
  } else {
    cache = { ...DEFAULT_STORE, ...parsed };
  }
  if (!cache.guilds || typeof cache.guilds !== 'object') {
    cache.guilds = {};
  }
}

function save() {
  ensureLoaded();
  writeJsonSync(STORE_FILE, cache);
}

function getGuildEntry(guildId) {
  ensureLoaded();
  if (!guildId) return null;

  if (!cache.guilds[guildId] || typeof cache.guilds[guildId] !== 'object') {
    cache.guilds[guildId] = {
      users: {},
      games: {},
      highestPayout: { game: null, userId: null, amount: 0 },
      updatedAt: 0,
    };
  }

  const guild = cache.guilds[guildId];
  if (!guild.users || typeof guild.users !== 'object') guild.users = {};
  if (!guild.games || typeof guild.games !== 'object') guild.games = {};

  const highest = guild.highestPayout && typeof guild.highestPayout === 'object' ? guild.highestPayout : {};
  guild.highestPayout = {
    game: typeof highest.game === 'string' ? highest.game : null,
    userId: typeof highest.userId === 'string' ? highest.userId : null,
    amount: toWholeNumber(highest.amount),
  };

  guild.updatedAt = toWholeNumber(guild.updatedAt);
  return guild;
}

function ensureUser(guild, userId) {
  if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
    guild.users[userId] = {
      totalWon: 0,
      totalLost: 0,
      totalBet: 0,
      totalPayout: 0,
      games: {},
    };
  }
  guild.users[userId] = normalizeUserStats(guild.users[userId]);
  return guild.users[userId];
}

function ensureGame(guild, game) {
  if (!guild.games[game] || typeof guild.games[game] !== 'object') {
    guild.games[game] = {
      totalPaidOut: 0,
      rounds: 0,
      topPayout: { userId: null, amount: 0 },
    };
  }
  guild.games[game] = normalizeGameStats(guild.games[game]);
  return guild.games[game];
}

function recordRound(guildId, game, results) {
  if (!guildId || !game) return null;
  const guild = getGuildEntry(guildId);
  if (!guild) return null;

  const gameStats = ensureGame(guild, game);
  gameStats.rounds += 1;

  const entries = Array.isArray(results) ? results : [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object' || !raw.userId) continue;

    const amountBet = toWholeNumber(raw.amountBet);
    const amountWon = toWholeNumber(raw.amountWon);
    const fallbackNet = amountWon - amountBet;
    const net = Number.isFinite(Number(raw.net)) ? Math.floor(Number(raw.net)) : fallbackNet;

    const user = ensureUser(guild, raw.userId);
    user.totalBet += amountBet;
    user.totalPayout += amountWon;

    const gameRecord = normalizeWinLossRecord(user.games[game]);
    const didWin = typeof raw.didWin === 'boolean' ? raw.didWin : net > 0;
    const didLose = typeof raw.didLose === 'boolean' ? raw.didLose : net < 0;
    if (didWin) gameRecord.wins += 1;
    if (didLose) gameRecord.losses += 1;
    user.games[game] = gameRecord;

    if (net > 0) user.totalWon += toWholeNumber(net);
    if (net < 0) user.totalLost += toWholeNumber(Math.abs(net));

    gameStats.totalPaidOut += amountWon;
    if (amountWon > gameStats.topPayout.amount) {
      gameStats.topPayout = { userId: raw.userId, amount: amountWon };
    }
    if (amountWon > guild.highestPayout.amount) {
      guild.highestPayout = { game, userId: raw.userId, amount: amountWon };
    }
  }

  guild.updatedAt = Date.now();
  save();
  return getSummary(guildId);
}

function getUserGameRecord(guildId, userId, game) {
  if (!guildId || !userId || !game) return { wins: 0, losses: 0 };
  const guild = getGuildEntry(guildId);
  if (!guild) return { wins: 0, losses: 0 };
  const user = ensureUser(guild, userId);
  return normalizeWinLossRecord(user.games[game]);
}

function findTopUser(users, key) {
  const entries = Object.entries(users || {});
  if (!entries.length) return null;

  let best = null;
  for (const [userId, stats] of entries) {
    const normalized = normalizeUserStats(stats);
    const amount = normalized[key];
    if (!best || amount > best.amount) best = { userId, amount };
  }
  if (!best || best.amount <= 0) return null;
  return best;
}

function findTopGame(games) {
  const entries = Object.entries(games || {});
  if (!entries.length) return null;

  let best = null;
  for (const [game, stats] of entries) {
    const normalized = normalizeGameStats(stats);
    if (!best || normalized.totalPaidOut > best.totalPaidOut) {
      best = {
        game,
        totalPaidOut: normalized.totalPaidOut,
        rounds: normalized.rounds,
        topPayout: normalized.topPayout,
      };
    }
  }
  return best;
}

function getSummary(guildId) {
  const guild = getGuildEntry(guildId);
  if (!guild) {
    return {
      topWinner: null,
      topLoser: null,
      topGame: null,
      highestPayout: null,
      usersTracked: 0,
      gamesTracked: 0,
      updatedAt: 0,
    };
  }

  const highest = guild.highestPayout || { game: null, userId: null, amount: 0 };
  const highestPayout = highest.amount > 0
    ? { game: highest.game, userId: highest.userId, amount: highest.amount }
    : null;

  return {
    topWinner: findTopUser(guild.users, 'totalWon'),
    topLoser: findTopUser(guild.users, 'totalLost'),
    topGame: findTopGame(guild.games),
    highestPayout,
    usersTracked: Object.keys(guild.users || {}).length,
    gamesTracked: Object.keys(guild.games || {}).length,
    updatedAt: guild.updatedAt,
  };
}

module.exports = {
  recordRound,
  getSummary,
  getUserGameRecord,
};
