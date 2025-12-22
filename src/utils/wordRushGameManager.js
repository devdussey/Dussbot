const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} = require('discord.js');
const wordRushStatsStore = require('./wordRushStatsStore');
const rupeeStore = require('./rupeeStore');
const { resolveEmbedColour } = require('./guildColourStore');
const {
  pickPlayableLetters,
  formatLetters,
  normaliseCandidateWord,
  containsLettersInOrder,
} = require('./wordRushLogic');

const JOIN_WINDOW_MS = 30_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;
const LIVES_PER_PLAYER = 2;

const DEFAULT_TURN_SECONDS = 10;
const MIN_TURN_SECONDS = 5;
const MAX_TURN_SECONDS = 60;

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
  if (game.stage !== 'waiting') {
    return { ok: false, error: 'The join window is closed.' };
  }
  if (game.players.length >= MAX_PLAYERS) {
    return { ok: false, error: `This WordRush lobby is full (max ${MAX_PLAYERS} players).` };
  }
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
  game.lives.delete(userId);
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

function formatLivesBoard(game) {
  const entries = game.players
    .map(userId => ({
      userId,
      lives: game.lives.get(userId) ?? 0,
      profile: game.profiles.get(userId) || null,
    }))
    .sort((a, b) => {
      if (b.lives !== a.lives) return b.lives - a.lives;
      return a.userId.localeCompare(b.userId);
    });

  const lines = entries.map(entry => `- ${formatPlayerName(entry.profile, entry.userId)}: ${entry.lives} life${entry.lives === 1 ? '' : 's'}`);
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

    collector.on('collect', async (message) => {
      if (accepted) return;

      const candidate = normaliseCandidateWord(message.content);
      const ok = Boolean(candidate && containsLettersInOrder(candidate, letters));

      try {
        await message.react(ok ? '✅' : '❌');
      } catch (_) {}

      if (!ok) return;

      accepted = {
        word: candidate,
        messageId: message.id,
      };
      try { collector.stop('answered'); } catch (_) {}
    });

    collector.on('end', (_, reason) => {
      if (game.currentCollector === collector) game.currentCollector = null;
      if (game.currentTurnUserId === userId) game.currentTurnUserId = null;

      if (accepted) return resolve({ ok: true, word: accepted.word, messageId: accepted.messageId, reason: reason || 'answered' });
      return resolve({ ok: false, reason: reason || 'timeout' });
    });
  });
}

function buildLobbyComponents({ joinButtonId, disabled }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(joinButtonId)
      .setLabel('Join WordRush')
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(disabled)),
  );
  return [row];
}

function getEmbedColour(game) {
  return resolveEmbedColour(game.guildId, 0x5865F2);
}

function formatRoster(game) {
  return game.players.length ? game.players.map(id => `<@${id}>`).join(', ') : '_No players yet._';
}

function buildLobbyEmbed(game, joinDeadline) {
  const now = Date.now();
  const secondsLeft = Math.max(0, Math.ceil((joinDeadline - now) / 1000));

  return new EmbedBuilder()
    .setColor(getEmbedColour(game))
    .setTitle('WordRush Lobby')
    .setDescription(`Click **Join WordRush** below to enter.\nStarting in **${secondsLeft}s**.`)
    .addFields(
      { name: `Players (${game.players.length}/${MAX_PLAYERS})`, value: formatRoster(game) },
      {
        name: 'Rules',
        value: 'On your turn, you get 3 letters and have a short time limit to reply with a single word that contains those letters **in order**.\nNames and swear words are allowed.',
      },
      { name: 'Settings', value: `Lives: **${LIVES_PER_PLAYER}** each\nTurn timer: **${game.turnSeconds}s**` },
    );
}

function buildTurnPromptEmbed(game, { letters }) {
  const compact = Array.isArray(letters) ? letters.map(letter => String(letter || '').toUpperCase()).join('') : '';
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setDescription(`↳ _Your word must contain:_ **${escapeMarkdown(compact)}**`);
}

function buildStatusEmbed(game, { title, description, fields }) {
  const embed = new EmbedBuilder()
    .setColor(getEmbedColour(game))
    .setTitle(title || 'WordRush')
    .setDescription(description || '');

  if (Array.isArray(fields) && fields.length) {
    embed.addFields(...fields);
  }

  return embed;
}

async function runWordRushGame(game) {
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

    const result = joinWordRushGame(game, componentInteraction.user);
    if (!result.ok) {
      await componentInteraction.reply({ content: result.error || 'Unable to join right now.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!result.joined) {
      await componentInteraction.reply({ content: 'You are already in this WordRush game.', ephemeral: true }).catch(() => {});
      return;
    }

    await componentInteraction.reply({ content: 'Joined WordRush!', ephemeral: true }).catch(() => {});
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
        buildStatusEmbed(game, {
          title: 'WordRush',
          description: game.stopReason === 'stopped'
            ? 'WordRush stopped.'
            : game.stopReason === 'no-players'
              ? 'WordRush ended: no players remaining.'
              : 'WordRush ended.',
          fields: [{ name: `Players (${game.players.length})`, value: formatRoster(game) }],
        }),
      ],
      components: buildLobbyComponents({ joinButtonId: game.joinButtonId, disabled: true }),
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return;
  }

  game.stage = 'playing';
  game.startedPlayerIds = Array.from(game.playerSet);

  await lobbyMessage.edit({
    embeds: [buildLobbyEmbed(game, joinDeadline)],
    components: buildLobbyComponents({ joinButtonId: game.joinButtonId, disabled: true }),
    allowedMentions: { parse: [] },
  }).catch(() => {});

  if (game.players.length < MIN_PLAYERS) {
    await lobbyMessage.edit({
      embeds: [
        buildStatusEmbed(game, {
          title: 'WordRush Cancelled',
          description: `Not enough players joined (need ${MIN_PLAYERS}).`,
          fields: [{ name: `Players (${game.players.length})`, value: formatRoster(game) }],
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    game.stop('not-enough-players');
    return;
  }

  for (const userId of game.players) {
    game.lives.set(userId, LIVES_PER_PLAYER);
  }

  await lobbyMessage.edit({
    embeds: [
      buildStatusEmbed(game, {
        title: 'WordRush Started',
        description: 'Game is live. Wait for your turn!',
        fields: [
          { name: `Players (${game.players.length})`, value: formatRoster(game) },
          { name: 'Settings', value: `Lives: **${LIVES_PER_PLAYER}** each\nTurn timer: **${game.turnSeconds}s**` },
        ],
      }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => {});

  while (!game.isStopped) {
    if (!game.players.length) {
      game.stop('no-players');
      break;
    }

    if (game.players.length === 1) {
      game.winnerId = game.players[0];
      game.stop('winner');
      break;
    }

    if (game.turnIndex >= game.players.length) game.turnIndex = 0;
    const userId = game.players[game.turnIndex];
    if (!userId) {
      game.turnIndex = 0;
      continue;
    }

    const previousTurnIndex = game.turnIndex;
    const livesRemaining = game.lives.get(userId) ?? 0;
    if (livesRemaining <= 0) {
      game.players = game.players.filter(id => id !== userId);
      game.playerSet.delete(userId);
      game.profiles.delete(userId);
      game.lives.delete(userId);
      continue;
    }

    const letters = pickPlayableLetters();

    await game.channel.send({
      content: `<@${userId}>`,
      embeds: [buildTurnPromptEmbed(game, { letters })],
      allowedMentions: { users: [userId] },
    }).catch(() => {});

    await lobbyMessage.edit({
      embeds: [
        buildStatusEmbed(game, {
          title: 'WordRush',
          description: `Turn: <@${userId}>`,
          fields: [
            { name: 'Players', value: formatLivesBoard(game) },
            ...(game.lastResult ? [{ name: 'Last Result', value: game.lastResult }] : []),
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});

    // eslint-disable-next-line no-await-in-loop
    const response = await waitForTurnWord(game, userId, letters);
    if (game.isStopped) break;

    if (response.ok && response.word) {
      game.lastResult = `<@${userId}> ✅ **${escapeMarkdown(response.word)}**`;
      await lobbyMessage.edit({
        embeds: [
          buildStatusEmbed(game, {
            title: 'WordRush',
            description: `Turn complete.`,
            fields: [
              { name: 'Last Result', value: game.lastResult },
              { name: 'Players', value: formatLivesBoard(game) },
            ],
          }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    } else {
      const nextLives = (game.lives.get(userId) ?? 0) - 1;
      game.lives.set(userId, Math.max(0, nextLives));

      const eliminated = nextLives <= 0;
      if (eliminated) {
        game.players = game.players.filter(id => id !== userId);
        game.playerSet.delete(userId);
      }

      game.lastResult = eliminated
        ? `<@${userId}> ❌ eliminated.`
        : `<@${userId}> ❌ lost a life. Lives remaining: **${Math.max(0, nextLives)}**.`;

      await lobbyMessage.edit({
        embeds: [
          buildStatusEmbed(game, {
            title: 'WordRush',
            description: game.lastResult,
            fields: [{ name: 'Players', value: formatLivesBoard(game) }],
          }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});

      if (game.players.length === 1) {
        game.winnerId = game.players[0];
        game.stop('winner');
        break;
      }
    }

    if (!game.players.length) {
      game.stop('no-players');
      break;
    }

    const currentIndex = game.players.indexOf(userId);
    if (currentIndex !== -1) {
      game.turnIndex = (currentIndex + 1) % game.players.length;
    } else {
      game.turnIndex = previousTurnIndex;
      if (game.turnIndex >= game.players.length) game.turnIndex = 0;
    }
  }

  const finishedAt = Date.now();

  if (game.stopReason === 'winner' && game.winnerId) {
    const newBalance = await rupeeStore.addTokens(game.guildId, game.winnerId, 1).catch(() => null);
    const rupeeLine = Number.isFinite(newBalance)
      ? `Winner earned **1 Rupee**. New balance: **${newBalance}**.`
      : 'Winner earned **1 Rupee**.';

    await lobbyMessage.edit({
      embeds: [
        buildStatusEmbed(game, {
          title: 'WordRush Complete',
          description: `Winner: <@${game.winnerId}>\n${rupeeLine}`,
          fields: [{ name: 'Final Players', value: formatLivesBoard(game) }],
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});

    wordRushStatsStore.recordGame(game.guildId, {
      winnerId: game.winnerId,
      playerIds: Array.isArray(game.startedPlayerIds) ? game.startedPlayerIds : Array.from(game.playerSet),
      turnSeconds: game.turnSeconds,
      livesPerPlayer: LIVES_PER_PLAYER,
      finishedAt,
    });
    return;
  }

  if (game.stopReason === 'no-players') {
    await lobbyMessage.edit({
      embeds: [
        buildStatusEmbed(game, {
          title: 'WordRush Ended',
          description: 'No players remaining.',
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return;
  }

  if (game.stopReason && game.stopReason !== 'stopped') {
    await lobbyMessage.edit({
      embeds: [
        buildStatusEmbed(game, {
          title: 'WordRush Ended',
          description: 'WordRush ended.',
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return;
  }

  await lobbyMessage.edit({
    embeds: [
      buildStatusEmbed(game, {
        title: 'WordRush Stopped',
        description: 'WordRush stopped.',
      }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function startWordRushGame(interaction, options) {
  const { turnSeconds } = options || {};
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

  const game = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guildId,
    channelId,
    channel,
    hostId: interaction.user.id,
    stage: 'waiting',
    joinButtonId: `wordrush-join-${interaction.id}-${Date.now()}`,
    lobbyMessageId: null,
    players: [],
    playerSet: new Set(),
    profiles: new Map(),
    lives: new Map(),
    turnIndex: 0,
    turnSeconds: actualTurnSeconds,
    currentCollector: null,
    currentTurnUserId: null,
    isStopped: false,
    stopReason: null,
    winnerId: null,
    startedPlayerIds: null,
    startedAt: Date.now(),
    lastResult: null,
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
