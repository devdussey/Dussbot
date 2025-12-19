const { escapeMarkdown } = require('discord.js');
const wordRushStatsStore = require('./wordRushStatsStore');
const {
  pickLetters,
  formatLetters,
  normaliseCandidateWord,
  containsLettersInOrder,
} = require('./wordRushLogic');

const DEFAULT_TURN_SECONDS = 10;
const MIN_TURN_SECONDS = 5;
const MAX_TURN_SECONDS = 60;

const DEFAULT_TARGET_WINS = 5;
const MIN_TARGET_WINS = 1;
const MAX_TARGET_WINS = 50;

const activeGames = new Map();

function getKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function formatPlayerName(profile, userId) {
  if (profile) {
    const name = profile.displayName || profile.globalName || profile.username;
    if (name) return escapeMarkdown(name);
  }
  return `<@${userId}>`;
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  return Math.max(min, Math.min(max, rounded));
}

function getActiveGame(guildId, channelId) {
  if (!guildId || !channelId) return null;
  return activeGames.get(getKey(guildId, channelId)) || null;
}

function joinWordRushGame(game, user) {
  if (!game || !user) return { ok: false, error: 'No active WordRush game found.' };
  if (game.playerSet.has(user.id)) {
    return { ok: true, joined: false };
  }

  game.players.push(user.id);
  game.playerSet.add(user.id);
  game.profiles.set(user.id, {
    username: user.username || null,
    globalName: user.globalName || null,
    displayName: null,
  });

  return { ok: true, joined: true };
}

function leaveWordRushGame(game, userId) {
  if (!game || !userId) return { ok: false, error: 'No active WordRush game found.' };
  if (!game.playerSet.has(userId)) return { ok: true, left: false };

  game.playerSet.delete(userId);
  game.players = game.players.filter(id => id !== userId);
  game.scores.delete(userId);
  game.profiles.delete(userId);

  if (game.hostId === userId) {
    game.hostId = game.players[0] || null;
    if (!game.hostId) {
      game.stop('no-players');
    }
  }

  if (game.currentTurnUserId === userId && game.currentCollector) {
    try { game.currentCollector.stop('player-left'); } catch (_) {}
  }

  return { ok: true, left: true };
}

function formatScoreboard(game) {
  const entries = game.players
    .map(userId => ({
      userId,
      score: game.scores.get(userId) || 0,
      profile: game.profiles.get(userId) || null,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.userId.localeCompare(b.userId);
    });

  const lines = entries.map(entry => `- ${formatPlayerName(entry.profile, entry.userId)}: ${entry.score}`);
  return lines.length ? lines.join('\n') : '_No scores yet._';
}

async function waitForTurnWord(game, userId, letters) {
  const channel = game.channel;
  const turnMs = game.turnSeconds * 1000;

  if (!channel || typeof channel.createMessageCollector !== 'function') {
    return { ok: false, reason: 'channel-not-collectable' };
  }

  return new Promise(resolve => {
    let accepted = null;

    const collector = channel.createMessageCollector({
      filter: message => message.author?.id === userId && !message.author?.bot,
      time: turnMs,
      max: 6,
    });

    game.currentCollector = collector;
    game.currentTurnUserId = userId;

    collector.on('collect', message => {
      const candidate = normaliseCandidateWord(message.content);
      if (!candidate) return;
      if (!containsLettersInOrder(candidate, letters)) return;

      accepted = candidate;
      try { collector.stop('answered'); } catch (_) {}
    });

    collector.on('end', (_, reason) => {
      if (game.currentCollector === collector) game.currentCollector = null;
      if (game.currentTurnUserId === userId) game.currentTurnUserId = null;

      if (accepted) return resolve({ ok: true, word: accepted, reason: reason || 'answered' });
      return resolve({ ok: false, reason: reason || 'timeout' });
    });
  });
}

async function runWordRushGame(game) {
  const introLines = [
    '**WordRush** starting!',
    `Players: ${game.players.map(id => `<@${id}>`).join(', ')}`,
    `First to **${game.targetWins}** point${game.targetWins === 1 ? '' : 's'} wins.`,
    `Each turn: **${game.turnSeconds}s** to respond with a single word that contains the 3 letters **in the same order**.`,
    'Use `/wordrush join` to join, `/wordrush leave` to leave, `/wordrush stop` to end the game.',
  ];

  await game.channel.send({ content: introLines.join('\n') }).catch(() => {});

  while (!game.isStopped) {
    if (!game.players.length) {
      game.stop('no-players');
      break;
    }

    if (game.turnIndex >= game.players.length) game.turnIndex = 0;
    const userId = game.players[game.turnIndex];
    if (!userId) {
      game.turnIndex = 0;
      continue;
    }

    const letters = pickLetters(3);

    const promptLines = [
      `Turn: <@${userId}>`,
      `Letters: **${formatLetters(letters)}**`,
      `You have ${game.turnSeconds}s. Reply with a single word containing those letters in order.`,
    ];

    await game.channel.send({ content: promptLines.join('\n') }).catch(() => {});

    // eslint-disable-next-line no-await-in-loop
    const response = await waitForTurnWord(game, userId, letters);
    if (game.isStopped) break;

    if (response.ok && response.word) {
      const nextScore = (game.scores.get(userId) || 0) + 1;
      game.scores.set(userId, nextScore);

      const scoredLines = [
        `<@${userId}> scored a point with **${escapeMarkdown(response.word)}**.`,
        '',
        '**Scoreboard**',
        formatScoreboard(game),
      ];

      await game.channel.send({ content: scoredLines.join('\n') }).catch(() => {});

      if (nextScore >= game.targetWins) {
        game.winnerId = userId;
        game.stop('winner');
        break;
      }
    } else {
      const timeoutLines = [
        `<@${userId}> ran out of time.`,
        '',
        '**Scoreboard**',
        formatScoreboard(game),
      ];
      await game.channel.send({ content: timeoutLines.join('\n') }).catch(() => {});
    }

    game.turnIndex = (game.turnIndex + 1) % game.players.length;
  }

  const finishedAt = Date.now();

  if (game.stopReason === 'winner' && game.winnerId) {
    await game.channel.send({ content: `Game over! Winner: <@${game.winnerId}>` }).catch(() => {});
    wordRushStatsStore.recordGame(game.guildId, {
      winnerId: game.winnerId,
      playerIds: Array.from(game.playerSet),
      targetWins: game.targetWins,
      turnSeconds: game.turnSeconds,
      finishedAt,
    });
    return;
  }

  if (game.stopReason === 'no-players') {
    await game.channel.send({ content: 'WordRush ended: no players remaining.' }).catch(() => {});
    return;
  }

  if (game.stopReason && game.stopReason !== 'stopped') {
    await game.channel.send({ content: 'WordRush ended.' }).catch(() => {});
    return;
  }

  await game.channel.send({ content: 'WordRush stopped.' }).catch(() => {});
}

async function startWordRushGame(interaction, options) {
  const { targetWins, turnSeconds } = options || {};
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  const key = getKey(guildId, channelId);
  if (activeGames.has(key)) {
    const existing = activeGames.get(key);
    return { ok: false, error: `A WordRush game hosted by <@${existing.hostId}> is already running in this channel.` };
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') {
    return { ok: false, error: 'Unable to access this channel.' };
  }

  const actualTurnSeconds = clampInt(turnSeconds, MIN_TURN_SECONDS, MAX_TURN_SECONDS, DEFAULT_TURN_SECONDS);
  const actualTargetWins = clampInt(targetWins, MIN_TARGET_WINS, MAX_TARGET_WINS, DEFAULT_TARGET_WINS);

  const game = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guildId,
    channelId,
    channel,
    hostId: interaction.user.id,
    players: [],
    playerSet: new Set(),
    profiles: new Map(),
    scores: new Map(),
    turnIndex: 0,
    turnSeconds: actualTurnSeconds,
    targetWins: actualTargetWins,
    currentCollector: null,
    currentTurnUserId: null,
    isStopped: false,
    stopReason: null,
    winnerId: null,
    startedAt: Date.now(),
  };

  game.stop = (reason) => {
    if (game.isStopped) return;
    game.isStopped = true;
    game.stopReason = reason || 'stopped';
    if (game.currentCollector) {
      try { game.currentCollector.stop('game-stopped'); } catch (_) {}
    }
  };

  joinWordRushGame(game, interaction.user);

  activeGames.set(key, game);

  runWordRushGame(game)
    .catch(err => {
      console.error('WordRush game encountered an unexpected error:', err);
    })
    .finally(() => {
      activeGames.delete(key);
    });

  return { ok: true, game };
}

function stopWordRushGame(guildId, channelId, reason = 'stopped') {
  const game = getActiveGame(guildId, channelId);
  if (!game) return false;
  game.stop(reason);
  return true;
}

module.exports = {
  startWordRushGame,
  stopWordRushGame,
  getActiveGame,
  joinWordRushGame,
  leaveWordRushGame,
};

