const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} = require('discord.js');
const sentenceRushStatsStore = require('./sentenceRushStatsStore');
const sentenceRushConfigStore = require('./sentenceRushConfigStore');
const sentencePool = require('./sentenceRushSentences');
const { resolveEmbedColour } = require('./guildColourStore');

const JOIN_WINDOW_MS = 30_000;
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 6;
const DEFAULT_TURN_SECONDS = 30;
const MIN_TURN_SECONDS = 30;
const MAX_TURN_SECONDS = 60;

const activeGames = new Map();

function getKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWord(input) {
  const normalized = normalizeText(input);
  if (!normalized) return '';
  return normalized.split(' ')[0] || '';
}

const SENTENCES = Array.isArray(sentencePool)
  ? sentencePool
    .map(sentence => {
      const original = String(sentence || '').trim();
      const normalized = normalizeText(original);
      if (!normalized) return null;
      const words = normalized.split(' ').filter(Boolean);
      if (words.length < 3 || words.length > 8) return null;
      return { original: original || normalized, normalized, wordCount: words.length };
    })
    .filter(Boolean)
  : [];

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  return Math.max(min, Math.min(max, rounded));
}

function pickSentence(minWords, maxWords) {
  if (!SENTENCES.length) return null;
  const min = clampInt(minWords, 3, 8, 3);
  const max = clampInt(maxWords, min, 8, 8);
  const candidates = SENTENCES.filter(entry => entry.wordCount >= min && entry.wordCount <= max);
  if (!candidates.length) return null;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

function getActiveGame(guildId, channelId) {
  if (!guildId || !channelId) return null;
  return activeGames.get(getKey(guildId, channelId)) || null;
}

function joinSentenceRushGame(game, user) {
  if (!game || !user) return { ok: false, error: 'No active SentenceRush game found.' };
  if (game.stage !== 'waiting') {
    return { ok: false, error: 'The join window is closed.' };
  }
  if (game.players.length >= MAX_PLAYERS) {
    return { ok: false, error: `This SentenceRush lobby is full (max ${MAX_PLAYERS} players).` };
  }
  if (game.playerSet.has(user.id)) {
    return { ok: true, joined: false };
  }

  game.players.push(user.id);
  game.playerSet.add(user.id);
  return { ok: true, joined: true };
}

function formatRoster(game) {
  return game.players.length ? game.players.map(id => `<@${id}>`).join(', ') : '_No players yet._';
}

function buildLobbyComponents({ joinButtonId, disabled }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(joinButtonId)
      .setLabel('Join SentenceRush')
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(disabled)),
  );
  return [row];
}

function buildHintComponents(game, { disabled = false } = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(game.hintButtonId)
      .setLabel('Use Hint (1x)')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(disabled)),
  );
  return [row];
}

function getEmbedColour(game) {
  return resolveEmbedColour(game.guildId, 0x5865F2);
}

function buildLobbyEmbed(game, joinDeadline) {
  const now = Date.now();
  const secondsLeft = Math.max(0, Math.ceil((joinDeadline - now) / 1000));

  return new EmbedBuilder()
    .setColor(getEmbedColour(game))
    .setTitle('SentenceRush Lobby')
    .setDescription(`Click **Join SentenceRush** below to enter.\nStarting in **${secondsLeft}s**.`)
    .addFields(
      { name: `Players (${game.players.length}/${MAX_PLAYERS})`, value: formatRoster(game) },
      {
        name: 'Rules',
        value: 'Take turns guessing the hidden sentence. Send one word per message; each message advances to the next word. Correct letters in the right position reveal for everyone. Correct letters in the wrong position appear in **bold** in the last guess.',
      },
      { name: 'Settings', value: `Turn timer: **${game.turnSeconds}s**` },
    );
}

function renderPuzzle(target, revealed) {
  const words = [];
  let current = [];

  for (let i = 0; i < target.length; i += 1) {
    const ch = target[i];
    if (ch === ' ') {
      if (current.length) {
        words.push(current.join(' '));
        current = [];
      }
      continue;
    }
    const shown = revealed[i] ? ch.toUpperCase() : '_';
    current.push(shown);
  }

  if (current.length) words.push(current.join(' '));
  return words.join('   ');
}

function formatGuess(chars, statuses) {
  const words = [];
  let current = [];

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const status = statuses[i];
    if (ch === ' ') {
      if (current.length) {
        words.push(current.join('|'));
        current = [];
      }
      continue;
    }
    let display = ch.toUpperCase();
    if (status === 'present') display = `**${display}**`;
    current.push(display);
  }

  if (current.length) words.push(current.join('|'));
  return words.join(' / ') || '_No guess._';
}

function buildGuessString(game, guessWords) {
  const parts = game.targetWords.map((targetWord, index) => {
    const raw = guessWords[index] || '';
    const cleaned = extractWord(raw);
    const trimmed = cleaned.slice(0, targetWord.length);
    return trimmed.padEnd(targetWord.length, ' ');
  });
  return parts.join(' ');
}

function applyGuess(game, guessWords) {
  const target = game.target;
  const targetChars = target.split('');
  const guessChars = buildGuessString(game, guessWords).split('');
  const correctPositions = new Array(targetChars.length).fill(false);

  const limit = Math.min(targetChars.length, guessChars.length);
  for (let i = 0; i < limit; i += 1) {
    const targetChar = targetChars[i];
    const guessChar = guessChars[i];
    if (targetChar !== ' ' && guessChar === targetChar) {
      correctPositions[i] = true;
      game.revealed[i] = true;
    }
  }

  const counts = {};
  for (let i = 0; i < targetChars.length; i += 1) {
    const ch = targetChars[i];
    if (ch === ' ' || correctPositions[i]) continue;
    counts[ch] = (counts[ch] || 0) + 1;
  }

  const statuses = guessChars.map((ch, index) => {
    if (ch === ' ') return 'space';
    if (index < targetChars.length && ch === targetChars[index]) return 'correct';
    if (counts[ch] > 0) {
      counts[ch] -= 1;
      return 'present';
    }
    return 'absent';
  });

  return formatGuess(guessChars, statuses);
}

function revealHint(game) {
  const target = game.target;
  const candidates = [];
  for (let i = 0; i < target.length; i += 1) {
    if (target[i] !== ' ' && !game.revealed[i]) candidates.push(i);
  }
  if (!candidates.length) return null;
  const index = candidates[Math.floor(Math.random() * candidates.length)];
  game.revealed[index] = true;
  return target[index].toUpperCase();
}

function buildGameEmbed(game) {
  const puzzle = renderPuzzle(game.target, game.revealed);
  const embed = new EmbedBuilder()
    .setColor(getEmbedColour(game))
    .setTitle('SentenceRush')
    .setDescription(`The sentence is:\n\`${puzzle}\``)
    .addFields(
      { name: `Players (${game.players.length}/${MAX_PLAYERS})`, value: formatRoster(game) },
      {
        name: 'Turn',
        value: game.currentTurnUserId ? `<@${game.currentTurnUserId}> (${game.turnSeconds}s)` : 'Starting...',
        inline: true,
      },
      { name: 'Hints', value: String(game.hintsGiven || 0), inline: true },
      { name: 'Hint Button', value: 'Each player can press **Use Hint** once per game.', inline: false },
      { name: 'Last Guess', value: game.lastGuess || '_None yet._' },
    )
    .setFooter({ text: 'Bold letters are in the sentence but in a different position.' });

  if (game.lastHint) {
    embed.addFields({ name: 'Hint', value: game.lastHint });
  }

  return embed;
}

function scheduleCountdown(game, userId) {
  const turnMs = game.turnSeconds * 1000;
  if (turnMs < 10_000) return [];
  const timers = [];
  for (let seconds = 10; seconds >= 1; seconds -= 1) {
    const delay = turnMs - seconds * 1000;
    const timer = setTimeout(() => {
      if (game.isStopped || game.currentTurnUserId !== userId) return;
      game.channel.send({
        content: String(seconds),
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }, Math.max(0, delay));
    timers.push(timer);
  }
  return timers;
}

function clearCountdown(timers) {
  if (!Array.isArray(timers)) return;
  for (const timer of timers) clearTimeout(timer);
}

async function waitForTurnGuess(game, userId) {
  const channel = game.channel;
  const turnMs = game.turnSeconds * 1000;

  if (!channel || typeof channel.createMessageCollector !== 'function') {
    return { ok: false, reason: 'channel-not-collectable' };
  }

  return new Promise(resolve => {
    const guessWords = [];
    const countdownTimers = scheduleCountdown(game, userId);

    const collector = channel.createMessageCollector({
      filter: message => message.author?.id === userId && !message.author?.bot,
      time: turnMs,
      max: game.wordCount,
    });

    game.currentCollector = collector;
    game.currentTurnUserId = userId;

    collector.on('collect', (message) => {
      const word = extractWord(message.content);
      guessWords.push(word);
      if (guessWords.length >= game.wordCount) {
        try { collector.stop('complete'); } catch (_) {}
      }
    });

    collector.on('end', (_, reason) => {
      if (game.currentCollector === collector) game.currentCollector = null;
      clearCountdown(countdownTimers);

      if (guessWords.length) {
        return resolve({ ok: true, guessWords, reason: reason || 'answered' });
      }
      return resolve({ ok: false, guessWords, reason: reason || 'timeout' });
    });
  });
}

async function runSentenceRushGame(game) {
  const joinDeadline = Date.now() + JOIN_WINDOW_MS;

  const lobbyMessage = await game.channel.send({
    embeds: [buildLobbyEmbed(game, joinDeadline)],
    components: buildLobbyComponents({ joinButtonId: game.joinButtonId, disabled: game.players.length >= MAX_PLAYERS }),
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!lobbyMessage) {
    game.stop('error');
    return;
  }

  game.lobbyMessageId = lobbyMessage.id;

  const lobbyCollector = lobbyMessage.createMessageComponentCollector({
    time: JOIN_WINDOW_MS,
  });
  game.currentCollector = lobbyCollector;

  const lobbyTick = setInterval(() => {
    if (game.isStopped || game.stage !== 'waiting') return;
    if (Date.now() >= joinDeadline) return;
    lobbyMessage.edit({
      embeds: [buildLobbyEmbed(game, joinDeadline)],
      components: buildLobbyComponents({ joinButtonId: game.joinButtonId, disabled: game.players.length >= MAX_PLAYERS }),
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }, 5_000);

  lobbyCollector.on('collect', async (componentInteraction) => {
    if (componentInteraction.customId !== game.joinButtonId) return;
    if (game.isStopped || game.stage !== 'waiting') {
      await componentInteraction.reply({ content: 'The join window is closed.', ephemeral: true }).catch(() => {});
      return;
    }

    const result = joinSentenceRushGame(game, componentInteraction.user);
    if (!result.ok) {
      await componentInteraction.reply({ content: result.error || 'Unable to join right now.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!result.joined) {
      await componentInteraction.reply({ content: 'You are already in this SentenceRush game.', ephemeral: true }).catch(() => {});
      return;
    }

    await componentInteraction.reply({ content: 'Joined SentenceRush!', ephemeral: true }).catch(() => {});
    await lobbyMessage.edit({
      embeds: [buildLobbyEmbed(game, joinDeadline)],
      components: buildLobbyComponents({ joinButtonId: game.joinButtonId, disabled: game.players.length >= MAX_PLAYERS }),
      allowedMentions: { parse: [] },
    }).catch(() => {});
  });

  await new Promise(resolve => {
    lobbyCollector.on('end', () => resolve());
  });

  clearInterval(lobbyTick);
  if (game.currentCollector === lobbyCollector) game.currentCollector = null;

  if (game.isStopped) {
    await lobbyMessage.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(getEmbedColour(game))
          .setTitle('SentenceRush')
          .setDescription('SentenceRush ended.')
          .addFields({ name: `Players (${game.players.length})`, value: formatRoster(game) }),
      ],
      components: buildLobbyComponents({ joinButtonId: game.joinButtonId, disabled: true }),
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return;
  }

  game.stage = 'playing';
  game.startedPlayerIds = Array.from(game.playerSet);

  await lobbyMessage.edit({
    embeds: [buildGameEmbed(game)],
    components: buildHintComponents(game),
    allowedMentions: { parse: [] },
  }).catch(() => {});

  const hintCollector = lobbyMessage.createMessageComponentCollector({
    time: 60 * 60_000,
  });
  game.hintCollector = hintCollector;

  hintCollector.on('collect', async (componentInteraction) => {
    if (componentInteraction.customId !== game.hintButtonId) return;
    if (game.isStopped || game.stage !== 'playing') {
      await componentInteraction.reply({ content: 'The game is not active right now.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!game.playerSet.has(componentInteraction.user.id)) {
      await componentInteraction.reply({ content: 'Only active players can use a hint.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.hintUsed.has(componentInteraction.user.id)) {
      await componentInteraction.reply({ content: 'You already used your hint this game.', ephemeral: true }).catch(() => {});
      return;
    }

    const hintLetter = revealHint(game);
    if (!hintLetter) {
      await componentInteraction.reply({ content: 'All letters are already revealed.', ephemeral: true }).catch(() => {});
      return;
    }

    game.hintUsed.add(componentInteraction.user.id);
    game.hintsGiven += 1;
    game.lastHint = `<@${componentInteraction.user.id}> used a hint: **${hintLetter}**`;

    await componentInteraction.reply({ content: `Hint unlocked: **${hintLetter}**`, ephemeral: true }).catch(() => {});
    await lobbyMessage.edit({
      embeds: [buildGameEmbed(game)],
      components: buildHintComponents(game),
      allowedMentions: { parse: [] },
    }).catch(() => {});
  });

  if (game.players.length < MIN_PLAYERS) {
    await lobbyMessage.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(getEmbedColour(game))
          .setTitle('SentenceRush Cancelled')
          .setDescription(`Not enough players joined (need ${MIN_PLAYERS}).`)
          .addFields({ name: `Players (${game.players.length})`, value: formatRoster(game) }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    game.stop('not-enough-players');
    return;
  }

  game.turnIndex = 0;
  game.turnsThisRound = 0;

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

    game.currentTurnUserId = userId;

    await game.channel.send({
      content: `<@${userId}> it is your turn. You have ${game.turnSeconds}s to guess the sentence.`,
      embeds: [buildGameEmbed(game)],
      allowedMentions: { users: [userId] },
    }).catch(() => {});

    // eslint-disable-next-line no-await-in-loop
    const response = await waitForTurnGuess(game, userId);
    if (game.isStopped) break;

    const guessWords = Array.isArray(response.guessWords) ? response.guessWords : [];
    const guessString = guessWords.length ? buildGuessString(game, guessWords).trim() : '';
    const fullGuess = guessWords.length ? guessString : '';

    if (fullGuess && fullGuess === game.target) {
      game.winnerId = userId;
      game.stop('winner');
      break;
    }

    if (guessWords.length) {
      const formattedGuess = applyGuess(game, guessWords);
      game.lastGuess = `<@${userId}>: ${formattedGuess}`;
    } else if (response.ok) {
      game.lastGuess = `<@${userId}>: _Invalid guess._`;
    } else {
      game.lastGuess = `<@${userId}>: _No guess submitted._`;
    }

    game.turnIndex = (game.turnIndex + 1) % game.players.length;
    game.turnsThisRound += 1;

    if (game.turnsThisRound >= game.players.length) {
      game.turnsThisRound = 0;
      const hintLetter = revealHint(game);
      if (hintLetter) {
        game.hintsGiven += 1;
        game.lastHint = `Revealed letter: **${hintLetter}**`;
      } else {
        game.lastHint = 'All letters are already revealed.';
      }
    }

    const nextUserId = game.players[game.turnIndex] || null;
    game.currentTurnUserId = nextUserId;

    await lobbyMessage.edit({
      embeds: [buildGameEmbed(game)],
      components: buildHintComponents(game),
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  const finishedAt = Date.now();

  if (game.stopReason === 'winner' && game.winnerId) {
    sentenceRushStatsStore.recordGame(game.guildId, {
      winnerId: game.winnerId,
      playerIds: Array.isArray(game.startedPlayerIds) ? game.startedPlayerIds : Array.from(game.playerSet),
      sentence: game.originalSentence,
      finishedAt,
    });

    const winnerStats = sentenceRushStatsStore.getStats(game.guildId, game.winnerId);
    const wins = winnerStats?.wins ?? 0;

    const winnerEmbed = new EmbedBuilder()
      .setColor(getEmbedColour(game))
      .setTitle('SentenceRush Complete')
      .setDescription(
        `Winner: <@${game.winnerId}>\nTotal wins: **${wins}**\nSentence: **${escapeMarkdown(game.originalSentence)}**`
      );

    await lobbyMessage.edit({
      embeds: [winnerEmbed],
      components: buildHintComponents(game, { disabled: true }),
      allowedMentions: { parse: [] },
    }).catch(() => {});

    await game.channel.send({
      content: `SentenceRush winner: <@${game.winnerId}> (total wins: **${wins}**)`,
      allowedMentions: { users: [game.winnerId] },
    }).catch(() => {});
    return;
  }

  await lobbyMessage.edit({
    embeds: [
      new EmbedBuilder()
        .setColor(getEmbedColour(game))
        .setTitle('SentenceRush Ended')
        .setDescription('SentenceRush ended.'),
    ],
    components: buildHintComponents(game, { disabled: true }),
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function startSentenceRushGame(interaction) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  const key = getKey(guildId, channelId);
  if (activeGames.has(key)) {
    const existing = activeGames.get(key);
    return { ok: false, error: `A SentenceRush game hosted by <@${existing.hostId}> is already running in this channel.` };
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') {
    return { ok: false, error: 'Unable to access this channel.' };
  }

  const config = sentenceRushConfigStore.getConfig(guildId);
  const sentence = pickSentence(config.minWords, config.maxWords);
  if (!sentence) {
    return { ok: false, error: 'No sentences are available for SentenceRush with the current settings.' };
  }

  const game = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guildId,
    channelId,
    channel,
    hostId: interaction.user.id,
    stage: 'waiting',
    joinButtonId: `sentencerush-join-${interaction.id}-${Date.now()}`,
    lobbyMessageId: null,
    players: [],
    playerSet: new Set(),
    turnIndex: 0,
    turnsThisRound: 0,
    currentCollector: null,
    currentTurnUserId: null,
    isStopped: false,
    stopReason: null,
    winnerId: null,
    startedPlayerIds: null,
    startedAt: Date.now(),
    turnSeconds: clampInt(config.turnSeconds, MIN_TURN_SECONDS, MAX_TURN_SECONDS, DEFAULT_TURN_SECONDS),
    target: sentence.normalized,
    originalSentence: sentence.original,
    revealed: Array.from(sentence.normalized, ch => ch === ' '),
    targetWords: sentence.normalized.split(' '),
    wordCount: sentence.wordCount,
    hintButtonId: `sentencerush-hint-${interaction.id}-${Date.now()}`,
    hintUsed: new Set(),
    hintCollector: null,
    lastGuess: null,
    lastHint: null,
    hintsGiven: 0,
  };

  game.stop = (reason) => {
    if (game.isStopped) return;
    game.isStopped = true;
    game.stopReason = reason || 'stopped';
    if (game.currentCollector) {
      try { game.currentCollector.stop('game-stopped'); } catch (_) {}
    }
    if (game.hintCollector) {
      try { game.hintCollector.stop('game-stopped'); } catch (_) {}
    }
  };

  joinSentenceRushGame(game, interaction.user);

  activeGames.set(key, game);

  runSentenceRushGame(game)
    .catch(err => {
      console.error('SentenceRush game encountered an unexpected error:', err);
    })
    .finally(() => {
      activeGames.delete(key);
    });

  return { ok: true, game };
}

function stopSentenceRushGame(guildId, channelId, reason = 'stopped') {
  const game = getActiveGame(guildId, channelId);
  if (!game) return false;
  game.stop(reason);
  return true;
}

module.exports = {
  startSentenceRushGame,
  stopSentenceRushGame,
  getActiveGame,
  joinSentenceRushGame,
};
