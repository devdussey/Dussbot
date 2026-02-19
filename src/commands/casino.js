const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  escapeMarkdown,
} = require('discord.js');
const rupeeStore = require('../utils/rupeeStore');
const rouletteResultStore = require('../utils/rouletteResultStore');
const casinoStatsStore = require('../utils/casinoStatsStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { formatCurrencyAmount, getCurrencyName } = require('../utils/currencyName');

const JOIN_WINDOW_SECONDS = 30;
const COUNTDOWN_STEP_SECONDS = 5;
const SPIN_DURATION_MS = 10_000;
const HORSE_RACE_JOIN_WINDOW_SECONDS = 60;
const HORSE_RACE_COUNTDOWN_STEP_SECONDS = 5;
const HORSE_RACE_PROGRESS_UPDATE_MS = 5_000;
const HORSE_RACE_TOTAL_DURATION_MS = 30_000;
const HORSE_RACE_PROGRESS_STEPS = Math.floor(HORSE_RACE_TOTAL_DURATION_MS / HORSE_RACE_PROGRESS_UPDATE_MS);
const HORSE_RACE_TRACK_SLOTS = 15;
const HORSE_RACE_MIN_PLAYERS = 2;
const HORSE_RACE_MAX_PLAYERS = 6;
const HORSE_RACE_ENTRY_COST = 1;
const HORSE_RACE_TRACK_START = '▀▄';
const HORSE_RACE_TRACK_CELL = '⬩';
const HORSE_RACE_TRACK_FINISH = '🏁';
const HORSE_RACE_LANE_EMOJIS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const BLACK_NUMBERS = new Set([2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]);
const LOW_NUMBER_OPTIONS = ['0', '00', ...Array.from({ length: 18 }, (_, i) => String(i + 1))];
const HIGH_NUMBER_OPTIONS = Array.from({ length: 18 }, (_, i) => String(i + 19));
const BOARD_NUMBERS = [...LOW_NUMBER_OPTIONS, ...HIGH_NUMBER_OPTIONS];
const MULTIPLIERS = [1, 2, 5, 10];
const BET_PANEL_INSTRUCTION = 'Select the bets you would like to make using the select menu. When you are done, make sure to hit the green "Place Bets" Button';

const activeGames = new Map();
const guildLastBets = new Map();

function gameKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNumberColour(label) {
  if (label === '0' || label === '00') return '🟩 Green';
  const num = Number(label);
  if (RED_NUMBERS.has(num)) return '🟥 Red';
  if (BLACK_NUMBERS.has(num)) return '⬛ Black';
  return '🟩 Green';
}

function isWinningBet(bet, result) {
  const wins = [];
  if (bet.number && bet.number === result.value) wins.push({ label: `Number ${bet.number}`, odds: 35 });
  if (bet.color && bet.color === result.colorName.toLowerCase()) wins.push({ label: `${result.colorEmoji} ${bet.colorName}`, odds: 1 });
  if (bet.parity && bet.parity === result.parity) wins.push({ label: bet.parityName, odds: 1 });
  return wins;
}

function spinResult() {
  const value = BOARD_NUMBERS[Math.floor(Math.random() * BOARD_NUMBERS.length)];
  const colour = getNumberColour(value);
  const [colorEmoji, colorName] = colour.split(' ');
  const numeric = Number(value);
  const parity = Number.isInteger(numeric) && numeric >= 1 && numeric <= 36 ? (numeric % 2 === 0 ? 'even' : 'odd') : 'none';
  return { value, colorEmoji, colorName, parity };
}

function getLastBetStore(guildId) {
  if (!guildLastBets.has(guildId)) guildLastBets.set(guildId, new Map());
  return guildLastBets.get(guildId);
}

function rouletteBoardText() {
  return [
    '```',
    'American Roulette Board',
    '🟩0  🟩00',
    '🟥1 ⬛2 🟥3 ⬛4 🟥5 ⬛6 🟥7 ⬛8 🟥9 ⬛10 ⬛11 🟥12',
    '⬛13 🟥14 ⬛15 🟥16 ⬛17 🟥18 🟥19 ⬛20 🟥21 ⬛22 🟥23 ⬛24',
    '🟥25 ⬛26 🟥27 ⬛28 ⬛29 🟥30 ⬛31 🟥32 ⬛33 🟥34 ⬛35 🟥36',
    '```',
  ].join('\n');
}

function describeBetSelection(bet) {
  const selections = [];
  if (bet.number) selections.push(`Number ${bet.number}`);
  if (bet.color) selections.push(bet.colorName);
  if (bet.parity) selections.push(bet.parityName);
  return selections.length ? selections.join(' • ') : 'No selections';
}

function formatGameName(game) {
  if (!game || typeof game !== 'string') return 'Unknown';
  return game
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function getHorseLaneEmoji(index) {
  if (!Number.isInteger(index) || index < 0) return HORSE_RACE_LANE_EMOJIS[0];
  return HORSE_RACE_LANE_EMOJIS[index % HORSE_RACE_LANE_EMOJIS.length];
}

function renderHorseTrack(position, racerEmoji = HORSE_RACE_LANE_EMOJIS[0]) {
  const arr = Array(HORSE_RACE_TRACK_SLOTS).fill(HORSE_RACE_TRACK_CELL);
  const clamped = Math.max(0, Math.min(position, HORSE_RACE_TRACK_SLOTS - 1));
  arr[clamped] = racerEmoji || HORSE_RACE_LANE_EMOJIS[0];
  return `${HORSE_RACE_TRACK_START}   ${arr.join('   ')}   ${HORSE_RACE_TRACK_FINISH}`;
}

function normalizeHorseRaceLanes(game) {
  const next = new Map();
  let lane = 0;
  for (const horse of game.participants.values()) {
    horse.racerEmoji = getHorseLaneEmoji(lane);
    next.set(horse.userId, horse);
    lane += 1;
  }
  game.participants = next;
}

function buildHorseRaceLobbyEmbed(game) {
  const competitors = game.participants.size
    ? [...game.participants.values()]
      .map((horse) => `${horse.racerEmoji} - ${escapeMarkdown(horse.shortName || horse.displayName || 'Racer').slice(0, 32)}`)
      .join('\n')
    : '_No competitors yet._';

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(game.guildId, 0x00f0ff))
    .setTitle('🏇 Horse Race Lobby 🏇')
    .setDescription([
      '**Competitors**',
      competitors,
      '',
      `Entry Cost - ${formatCurrencyAmount(game.guildId, HORSE_RACE_ENTRY_COST)}`,
    ].join('\n'))
    .setFooter({ text: `Race Begins in ${game.secondsLeft} Seconds` });
}

function buildHorseRaceCancelledEmbed(game) {
  return new EmbedBuilder()
    .setColor(resolveEmbedColour(game.guildId, 0x00f0ff))
    .setTitle('🏇 Horse Race Lobby 🏇')
    .setDescription([
      'There are not enough competitors. Please try again later.',
      '',
      'Your entry fee has been reimbursed.',
    ].join('\n'));
}

function buildHorseRaceRunningEmbed(game, horses, step) {
  const lanes = horses.map((horse, index) => {
    const track = renderHorseTrack(horse.position, horse.racerEmoji || getHorseLaneEmoji(index));
    const name = escapeMarkdown(horse.shortName || horse.displayName || `Racer ${index + 1}`).slice(0, 32);
    return `${track}   **${name}**`;
  }).join('\n');

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(game.guildId, 0x22c55e))
    .setTitle(`🏇 Horse Race — Update ${step}/${HORSE_RACE_PROGRESS_STEPS}`)
    .setDescription(lanes || '_Race is preparing..._');
}

function buildHorseRaceResultEmbed(game, lines) {
  return new EmbedBuilder()
    .setColor(resolveEmbedColour(game.guildId, 0xf59e0b))
    .setTitle('🏇 🏁 Horse Race Results 🏁 🏇')
    .setDescription(lines.join('\n\n'));
}

function buildHorseRaceLobbyComponents(game, { disabled = false } = {}) {
  const joinId = `horserace-join-${game.raceId}`;
  const leaveId = `horserace-leave-${game.raceId}`;
  const joinDisabled = disabled || !game.isOpen || game.participants.size >= HORSE_RACE_MAX_PLAYERS;
  const leaveDisabled = disabled || !game.isOpen || game.participants.size === 0;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(joinId).setLabel('Join Race').setStyle(ButtonStyle.Success).setDisabled(joinDisabled),
      new ButtonBuilder().setCustomId(leaveId).setLabel('Leave Race').setStyle(ButtonStyle.Danger).setDisabled(leaveDisabled),
    ),
  ];
}

function buildPublicEmbed(game) {
  const currency = getCurrencyName(game.guildId);
  const bets = [...game.bets.values()];
  const bettors = bets.length
    ? bets.map((b) => {
      const parts = [];
      if (b.number) parts.push(`Number ${b.number} (${b.amountPerBet})`);
      if (b.color) parts.push(`${b.colorName} (${b.amountPerBet})`);
      if (b.parity) parts.push(`${b.parityName} (${b.amountPerBet})`);
      return `• ${b.userTag} — ${parts.join(', ')}`;
    }).join('\n')
    : '_No bets placed yet._';

  const history = rouletteResultStore.getHistory(game.guildId);
  const historyText = history.length
    ? history.slice(0, 10).map((entry, idx) => `${idx + 1}. ${entry.colorEmoji} ${entry.value} (${entry.colorName})`).join('\n')
    : '_No previous results yet._';

  return new EmbedBuilder()
    .setColor(resolveEmbedColour(game.guildId, 0x0ea5e9))
    .setTitle('🎰 Roulette Lobby')
    .setDescription(`${game.starterMention} has started a game of roulette. Click on **Join to Play**.\n\n[Cost 1 ${currency} per bet.]`)
    .addFields(
      { name: 'Current Bets', value: bettors },
      { name: 'Last 10 Results', value: historyText },
    )
    .setFooter({ text: `Betting closes in ${game.secondsLeft}s` });
}

function buildBetEmbed(game, userId, draft, notice = '') {
  const balance = rupeeStore.getBalance(game.guildId, userId);
  const selected = [];
  if (draft.number) selected.push(`Number ${draft.number}`);
  if (draft.color) selected.push(draft.colorName);
  if (draft.parity) selected.push(draft.parityName);
  const selections = selected.length ? selected.join(' • ') : 'No active selections';
  const count = [draft.number, draft.color, draft.parity].filter(Boolean).length;
  const total = count * draft.multiplier;
  const lastBetStore = getLastBetStore(game.guildId);
  const lastBet = lastBetStore.get(userId);
  const lastBetText = lastBet
    ? [lastBet.number ? `Number ${lastBet.number}` : null, lastBet.color ? lastBet.colorName : null, lastBet.parity ? lastBet.parityName : null]
      .filter(Boolean)
      .join(' • ') + ` @ ${lastBet.multiplier}x`
    : 'None';

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(game.guildId, 0x22c55e))
    .setTitle('Current Bet')
    .setDescription(notice ? `${BET_PANEL_INSTRUCTION}\n\n${notice}` : BET_PANEL_INSTRUCTION)
    .addFields(
      { name: 'Selected Bets', value: selections },
      { name: 'Bet Amount', value: `${draft.multiplier} per selected bet (${total} total)` },
      { name: 'Balance', value: formatCurrencyAmount(game.guildId, balance, { lowercase: true }) },
      { name: 'Last Bet', value: lastBetText },
    );

  return embed;
}

function logRouletteInteractionError(error, interaction, context) {
  const details = {
    context,
    customId: interaction?.customId || null,
    userId: interaction?.user?.id || null,
    guildId: interaction?.guildId || null,
    channelId: interaction?.channelId || null,
    messageId: interaction?.message?.id || null,
    deferred: interaction?.deferred ?? null,
    replied: interaction?.replied ?? null,
  };
  console.error('[Roulette] Interaction error', details, error);
}

async function replyRouletteInteractionFailure(interaction) {
  const payload = { content: 'Roulette bet panel error. Check bot logs for details.', ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

function buildBetComponents(game, userId, draft) {
  const raceId = game.raceId;
  const lowNumberMenu = new StringSelectMenuBuilder()
    .setCustomId(`roulette-number-low-${raceId}`)
    .setPlaceholder('Numbers 0, 00 1-18')
    .addOptions([
      { label: 'Numbers 0, 00, 1-18', value: 'none', default: !draft.number },
      ...LOW_NUMBER_OPTIONS.map((num) => ({ label: num, value: num, default: draft.number === num })),
    ]);

  const highNumberMenu = new StringSelectMenuBuilder()
    .setCustomId(`roulette-number-high-${raceId}`)
    .setPlaceholder('Numbers 19-36')
    .addOptions(
      HIGH_NUMBER_OPTIONS.map((num) => ({ label: num, value: num, default: draft.number === num })),
    );

  const colorValue = draft.color ?? 'none';
  const colorMenu = new StringSelectMenuBuilder()
    .setCustomId(`roulette-color-${raceId}`)
    .setPlaceholder('Red / Black')
    .addOptions([
      { label: 'Red/Black Bet', value: 'none', default: colorValue === 'none' },
      { label: 'Red', value: 'red', default: colorValue === 'red' },
      { label: 'Black', value: 'black', default: colorValue === 'black' },
    ]);

  const parityValue = draft.parity ?? 'none';
  const parityMenu = new StringSelectMenuBuilder()
    .setCustomId(`roulette-parity-${raceId}`)
    .setPlaceholder('Odd / Even')
    .addOptions([
      { label: 'Odd/Even Bet', value: 'none', default: parityValue === 'none' },
      { label: 'Odd', value: 'odd', default: parityValue === 'odd' },
      { label: 'Even', value: 'even', default: parityValue === 'even' },
    ]);

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`roulette-mult-cycle-${raceId}`).setLabel(`Amount: ${draft.multiplier}x`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`roulette-place-${raceId}`).setLabel('Place Bets').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`roulette-clear-${raceId}`).setLabel('Clear Bet').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette-repeat-${raceId}`).setLabel('Repeat Last Bet').setStyle(ButtonStyle.Secondary).setDisabled(!getLastBetStore(game.guildId).has(userId)),
  );

  return [
    new ActionRowBuilder().addComponents(lowNumberMenu),
    new ActionRowBuilder().addComponents(highNumberMenu),
    new ActionRowBuilder().addComponents(colorMenu),
    new ActionRowBuilder().addComponents(parityMenu),
    actionRow,
  ];
}

async function updateLobbyMessage(game) {
  if (!game.message) return;
  try {
    await game.message.edit({
      embeds: [buildPublicEmbed(game)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`roulette-join-${game.raceId}`).setLabel('Join to Play').setStyle(ButtonStyle.Success).setDisabled(!game.isOpen))],
      content: rouletteBoardText(),
    });
  } catch (err) {
    console.error('Failed to update roulette lobby:', err);
  }
}

async function runRouletteGame(interaction, { initiatedByButton = false } = {}) {
  if (!interaction.inGuild()) {
    const payload = { content: 'Roulette can only be played in a server channel.', ephemeral: true };
    if (initiatedByButton) return interaction.reply(payload);
    return interaction.reply(payload);
  }

  const key = gameKey(interaction.guildId, interaction.channelId);
  if (activeGames.has(key)) {
    const payload = { content: 'A casino game is already active in this channel.', ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }

  const game = {
    raceId: `${interaction.id}-${Date.now()}`,
    guildId: interaction.guildId,
    channel: interaction.channel,
    starterMention: `<@${interaction.user.id}>`,
    bets: new Map(),
    drafts: new Map(),
    isOpen: true,
    secondsLeft: JOIN_WINDOW_SECONDS,
    message: null,
  };
  activeGames.set(key, game);

  const startPayload = {
    content: rouletteBoardText(),
    embeds: [buildPublicEmbed(game)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`roulette-join-${game.raceId}`).setLabel('Join to Play').setStyle(ButtonStyle.Success))],
  };

  if (interaction.deferred || interaction.replied) {
    game.message = await interaction.followUp(startPayload);
  } else {
    await interaction.reply(startPayload);
    game.message = await interaction.fetchReply();
  }

  const collector = game.channel.createMessageComponentCollector({
    time: JOIN_WINDOW_SECONDS * 1000,
    filter: (componentInteraction) => componentInteraction.customId.includes(game.raceId),
  });

  collector.on('collect', async (componentInteraction) => {
    const id = componentInteraction.customId;
    if (!id.includes(game.raceId)) return;
    try {
      if (!game.isOpen) {
        await componentInteraction.reply({ content: 'Betting is already closed for this round.', ephemeral: true });
        return;
      }

      const userId = componentInteraction.user.id;
      if (!game.drafts.has(userId)) game.drafts.set(userId, { number: null, color: null, parity: null, multiplier: 1, colorName: null, parityName: null });
      const draft = game.drafts.get(userId);

      if (id.startsWith(`roulette-join-`)) {
        await componentInteraction.reply({
          embeds: [buildBetEmbed(game, userId, draft)],
          components: buildBetComponents(game, userId, draft),
          ephemeral: true,
        });
        return;
      }

      if (id.startsWith(`roulette-number-low-`)) {
        const value = componentInteraction.values?.[0];
        draft.number = value === 'none' ? null : value;
        await componentInteraction.update({
          embeds: [buildBetEmbed(game, userId, draft, draft.number ? `Number bet set to ${draft.number}.` : 'Number bet cleared.')],
          components: buildBetComponents(game, userId, draft),
        });
        return;
      }

      if (id.startsWith(`roulette-number-high-`)) {
        const value = componentInteraction.values?.[0];
        draft.number = HIGH_NUMBER_OPTIONS.includes(value) ? value : draft.number;
        await componentInteraction.update({
          embeds: [buildBetEmbed(game, userId, draft, draft.number ? `Number bet set to ${draft.number}.` : 'Number bet cleared.')],
          components: buildBetComponents(game, userId, draft),
        });
        return;
      }

      if (id.startsWith(`roulette-color-`)) {
        const value = componentInteraction.values?.[0];
        draft.color = value === 'none' ? null : value;
        draft.colorName = value === 'none' ? null : (value === 'red' ? 'Red' : 'Black');
        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft)], components: buildBetComponents(game, userId, draft) });
        return;
      }

      if (id.startsWith(`roulette-parity-`)) {
        const value = componentInteraction.values?.[0];
        draft.parity = value === 'none' ? null : value;
        draft.parityName = value === 'none' ? null : (value === 'odd' ? 'Odd' : 'Even');
        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft)], components: buildBetComponents(game, userId, draft) });
        return;
      }

      if (id.startsWith(`roulette-mult-cycle-`)) {
        const currentIndex = MULTIPLIERS.indexOf(draft.multiplier);
        draft.multiplier = MULTIPLIERS[(currentIndex + 1) % MULTIPLIERS.length];
        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft)], components: buildBetComponents(game, userId, draft) });
        return;
      }

      if (id.startsWith(`roulette-mult-`)) {
        const parts = id.split('-');
        draft.multiplier = Number(parts[parts.length - 1]) || 1;
        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft)], components: buildBetComponents(game, userId, draft) });
        return;
      }

      if (id.startsWith(`roulette-clear-`)) {
        draft.number = null;
        draft.color = null;
        draft.colorName = null;
        draft.parity = null;
        draft.parityName = null;
        draft.multiplier = 1;
        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft, 'Bet cleared.')], components: buildBetComponents(game, userId, draft) });
        return;
      }

      if (id.startsWith(`roulette-repeat-`)) {
        const saved = getLastBetStore(game.guildId).get(userId);
        if (saved) {
          Object.assign(draft, saved);
        }
        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft, saved ? 'Loaded your last bet.' : 'No previous bet found.')], components: buildBetComponents(game, userId, draft) });
        return;
      }

      if (id.startsWith(`roulette-place-`)) {
        const count = [draft.number, draft.color, draft.parity].filter(Boolean).length;
        if (count === 0) {
          await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft, 'Select at least one bet before placing.')], components: buildBetComponents(game, userId, draft) });
          return;
        }
        const totalCost = count * draft.multiplier;

        const existing = game.bets.get(userId);
        if (existing) {
          await rupeeStore.addTokens(game.guildId, userId, existing.totalCost);
        }

        const paid = await rupeeStore.spendTokens(game.guildId, userId, totalCost);
        if (!paid) {
          if (existing) {
            await rupeeStore.spendTokens(game.guildId, userId, existing.totalCost);
          }
          await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft, `Not enough balance for this bet (needs ${formatCurrencyAmount(game.guildId, totalCost, { lowercase: true })}).`)], components: buildBetComponents(game, userId, draft) });
          return;
        }

        const displayName = escapeMarkdown(componentInteraction.member?.displayName || componentInteraction.user.globalName || componentInteraction.user.username);
        const placed = {
          userId,
          userTag: displayName,
          number: draft.number,
          color: draft.color,
          colorName: draft.colorName,
          parity: draft.parity,
          parityName: draft.parityName,
          amountPerBet: draft.multiplier,
          totalCost,
        };
        game.bets.set(userId, placed);
        getLastBetStore(game.guildId).set(userId, {
          number: draft.number,
          color: draft.color,
          colorName: draft.colorName,
          parity: draft.parity,
          parityName: draft.parityName,
          multiplier: draft.multiplier,
        });

        await componentInteraction.update({ embeds: [buildBetEmbed(game, userId, draft, `Bet placed for ${formatCurrencyAmount(game.guildId, totalCost, { lowercase: true })}.`)], components: buildBetComponents(game, userId, draft) });
        await updateLobbyMessage(game);
      }
    } catch (error) {
      logRouletteInteractionError(error, componentInteraction, 'bet_collect');
      try {
        await replyRouletteInteractionFailure(componentInteraction);
      } catch (replyError) {
        logRouletteInteractionError(replyError, componentInteraction, 'bet_collect_reply');
      }
    }
  });

  const interval = setInterval(async () => {
    game.secondsLeft = Math.max(0, game.secondsLeft - COUNTDOWN_STEP_SECONDS);
    await updateLobbyMessage(game);
    if (game.secondsLeft <= 0) clearInterval(interval);
  }, COUNTDOWN_STEP_SECONDS * 1000);

  collector.on('end', async () => {
    try {
      clearInterval(interval);
      game.isOpen = false;
      await updateLobbyMessage(game);

      const mentions = [...game.bets.keys()].map((id) => `<@${id}>`).join(' ');
      const closeEmbed = new EmbedBuilder()
        .setColor(resolveEmbedColour(game.guildId, 0xf59e0b))
        .setTitle('Bets Closed')
        .setDescription('Game Beginning');

      const gifPath = path.join(__dirname, '..', 'assets', 'roulette-spin.gif');
      const files = [];
      if (fs.existsSync(gifPath)) {
        files.push(new AttachmentBuilder(gifPath, { name: 'roulette-spin.gif' }));
        closeEmbed.setImage('attachment://roulette-spin.gif');
      }

      const spinMessage = await game.channel.send({ content: mentions || 'No bets were placed this round.', embeds: [closeEmbed], files });

      await new Promise((resolve) => setTimeout(resolve, SPIN_DURATION_MS));

      try { await spinMessage.delete(); } catch (_) {}

      const result = spinResult();
      const winners = [];
      const losers = [];
      const roundStats = [];

      for (const bet of game.bets.values()) {
        const winningBets = isWinningBet(bet, result);
        let payout = 0;
        for (const wb of winningBets) {
          payout += bet.amountPerBet * (wb.odds + 1);
        }
        if (payout > 0) {
          await rupeeStore.addTokens(game.guildId, bet.userId, payout);
        }

        const net = payout - bet.totalCost;
        roundStats.push({
          userId: bet.userId,
          amountBet: bet.totalCost,
          amountWon: payout,
          net,
        });

        if (net > 0) {
          winners.push({
            userTag: bet.userTag,
            amountBet: bet.totalCost,
            amountWon: payout,
          });
          continue;
        }

        if (net < 0) {
          losers.push({
            userTag: bet.userTag,
            betSelection: describeBetSelection(bet),
            amountLost: Math.abs(net),
          });
        }
      }

      rouletteResultStore.recordResult(game.guildId, {
        value: result.value,
        colorName: result.colorName,
        colorEmoji: result.colorEmoji,
      });

      try {
        casinoStatsStore.recordRound(game.guildId, 'roulette', roundStats);
      } catch (statsError) {
        console.error('[Roulette] Failed to record casino stats', { guildId: game.guildId, channelId: game.channel?.id, raceId: game.raceId }, statsError);
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(resolveEmbedColour(game.guildId, 0x6366f1))
        .setTitle('Roulette Result')
        .setDescription(`Result: ${result.colorEmoji} **${result.value} (${result.colorName})**`)
        .addFields(
          {
            name: 'WINNERS',
            value: winners.length
              ? winners.map((w) => `• ${w.userTag} - ${w.amountBet} bet - ${w.amountWon} won`).join('\n')
              : '_No winners this round._',
          },
          {
            name: 'LOSERS',
            value: losers.length
              ? losers.map((l) => `• ${l.userTag} - ${l.betSelection} - ${l.amountLost} lost`).join('\n')
              : '_No losers this round._',
          },
        );

      const playAgainId = `roulette-play-again-${Date.now()}`;
      const resultMessage = await game.channel.send({
        embeds: [resultEmbed],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(playAgainId).setLabel('Play Again').setStyle(ButtonStyle.Primary))],
      });

      const playAgainCollector = resultMessage.createMessageComponentCollector({ time: 120_000, max: 1 });
      playAgainCollector.on('collect', async (buttonInteraction) => {
        if (activeGames.has(gameKey(buttonInteraction.guildId, buttonInteraction.channelId))) {
          await buttonInteraction.reply({ content: 'A casino game is already active in this channel.', ephemeral: true });
          return;
        }
        await buttonInteraction.deferUpdate();
        await runRouletteGame(buttonInteraction, { initiatedByButton: true });
      });

      playAgainCollector.on('end', async () => {
        try {
          await resultMessage.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(playAgainId).setLabel('Play Again').setStyle(ButtonStyle.Secondary).setDisabled(true))] });
        } catch (_) {}
      });
    } catch (error) {
      console.error('[Roulette] Round close flow failed', { guildId: game.guildId, channelId: game.channel?.id, raceId: game.raceId }, error);
    } finally {
      activeGames.delete(key);
    }
  });
}

async function runHorseRaceGame(interaction, { initiatedByButton = false } = {}) {
  if (!interaction.inGuild()) {
    const payload = { content: 'Horse race can only be played in a server channel.', ephemeral: true };
    if (initiatedByButton) return interaction.reply(payload);
    return interaction.reply(payload);
  }

  const key = gameKey(interaction.guildId, interaction.channelId);
  if (activeGames.has(key)) {
    const payload = { content: 'A casino game is already active in this channel.', ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }

  const game = {
    type: 'horserace',
    raceId: `${interaction.id}-${Date.now()}`,
    guildId: interaction.guildId,
    channel: interaction.channel,
    participants: new Map(),
    entryPayments: new Set(),
    isOpen: true,
    secondsLeft: HORSE_RACE_JOIN_WINDOW_SECONDS,
    message: null,
  };

  activeGames.set(key, game);

  const startPayload = {
    embeds: [buildHorseRaceLobbyEmbed(game)],
    components: buildHorseRaceLobbyComponents(game),
    allowedMentions: { parse: [] },
  };

  try {
    if (interaction.deferred || interaction.replied) {
      game.message = await interaction.followUp(startPayload);
    } else {
      await interaction.reply(startPayload);
      game.message = await interaction.fetchReply();
    }
  } catch (err) {
    activeGames.delete(key);
    throw err;
  }

  const updateLobbyMessage = async ({ disabled = false, embedOverride = null, componentsOverride = null } = {}) => {
    if (!game.message) return;
    try {
      await game.message.edit({
        embeds: [embedOverride || buildHorseRaceLobbyEmbed(game)],
        components: componentsOverride || buildHorseRaceLobbyComponents(game, { disabled }),
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.error('[Horse Race] Failed to update lobby message:', err);
    }
  };

  const collector = game.channel.createMessageComponentCollector({
    time: HORSE_RACE_JOIN_WINDOW_SECONDS * 1000 + 10_000,
    filter: (buttonInteraction) => buttonInteraction.customId.includes(game.raceId),
  });

  collector.on('collect', async (buttonInteraction) => {
    const id = buttonInteraction.customId;
    try {
      if (id.startsWith(`horserace-join-`)) {
        if (!game.isOpen) {
          await buttonInteraction.reply({ content: 'The queue is closed for this race.', ephemeral: true });
          return;
        }
        if (game.participants.has(buttonInteraction.user.id)) {
          await buttonInteraction.reply({ content: 'You are already queued in this race.', ephemeral: true });
          return;
        }
        if (game.participants.size >= HORSE_RACE_MAX_PLAYERS) {
          await buttonInteraction.reply({ content: 'The race queue is full.', ephemeral: true });
          return;
        }

        const paid = await rupeeStore.spendTokens(game.guildId, buttonInteraction.user.id, HORSE_RACE_ENTRY_COST);
        if (!paid) {
          const balance = rupeeStore.getBalance(game.guildId, buttonInteraction.user.id);
          await buttonInteraction.reply({
            content: `Joining costs ${formatCurrencyAmount(game.guildId, HORSE_RACE_ENTRY_COST, { lowercase: true })}. You have ${formatCurrencyAmount(game.guildId, balance, { lowercase: true })}.`,
            ephemeral: true,
          });
          return;
        }

        const laneIndex = game.participants.size;
        const displayName = buttonInteraction.member?.displayName || buttonInteraction.user.globalName || buttonInteraction.user.username;
        const horse = {
          userId: buttonInteraction.user.id,
          displayName,
          shortName: displayName,
          racerEmoji: getHorseLaneEmoji(laneIndex),
          position: 0,
          finished: false,
          finishTick: Number.POSITIVE_INFINITY,
        };
        game.participants.set(buttonInteraction.user.id, horse);
        game.entryPayments.add(buttonInteraction.user.id);

        await buttonInteraction.reply({
          content: `You joined the race as ${horse.racerEmoji}. Entry fee paid: ${formatCurrencyAmount(game.guildId, HORSE_RACE_ENTRY_COST, { lowercase: true })}.`,
          ephemeral: true,
        });
        await updateLobbyMessage();
        return;
      }

      if (id.startsWith(`horserace-leave-`)) {
        if (!game.isOpen) {
          await buttonInteraction.reply({ content: 'The queue is already closed.', ephemeral: true });
          return;
        }
        if (!game.participants.has(buttonInteraction.user.id)) {
          await buttonInteraction.reply({ content: 'You are not queued in this race.', ephemeral: true });
          return;
        }

        game.participants.delete(buttonInteraction.user.id);
        normalizeHorseRaceLanes(game);
        if (game.entryPayments.has(buttonInteraction.user.id)) {
          await rupeeStore.addTokens(game.guildId, buttonInteraction.user.id, HORSE_RACE_ENTRY_COST);
          game.entryPayments.delete(buttonInteraction.user.id);
        }

        await buttonInteraction.reply({
          content: `You left the race. Refunded ${formatCurrencyAmount(game.guildId, HORSE_RACE_ENTRY_COST, { lowercase: true })}.`,
          ephemeral: true,
        });
        await updateLobbyMessage();
      }
    } catch (error) {
      console.error('[Horse Race] Lobby interaction failed:', error);
      const payload = { content: 'Horse race action failed. Try again.', ephemeral: true };
      if (buttonInteraction.deferred || buttonInteraction.replied) {
        await buttonInteraction.followUp(payload).catch(() => {});
      } else {
        await buttonInteraction.reply(payload).catch(() => {});
      }
    }
  });

  const interval = setInterval(async () => {
    if (!game.isOpen) return;
    game.secondsLeft = Math.max(0, game.secondsLeft - HORSE_RACE_COUNTDOWN_STEP_SECONDS);
    await updateLobbyMessage();
    if (game.secondsLeft <= 0) {
      game.isOpen = false;
      collector.stop('countdown_complete');
    }
  }, HORSE_RACE_COUNTDOWN_STEP_SECONDS * 1000);

  collector.on('end', async () => {
    clearInterval(interval);
    game.isOpen = false;
    let gameDeleted = false;

    try {
      await updateLobbyMessage({ disabled: true });

      const horses = [...game.participants.values()].map((horse) => ({
        ...horse,
        position: 0,
        finished: false,
        finishTick: Number.POSITIVE_INFINITY,
      }));

      if (horses.length < HORSE_RACE_MIN_PLAYERS) {
        for (const userId of game.entryPayments) {
          await rupeeStore.addTokens(game.guildId, userId, HORSE_RACE_ENTRY_COST);
        }
        game.entryPayments.clear();

        const retryId = `horserace-retry-${Date.now()}`;
        const retryComponents = [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(retryId).setLabel('Try Again').setStyle(ButtonStyle.Success),
          ),
        ];

        if (game.message) {
          await game.message.edit({
            embeds: [buildHorseRaceCancelledEmbed(game)],
            components: retryComponents,
            allowedMentions: { parse: [] },
          });
        }

        activeGames.delete(key);
        gameDeleted = true;

        if (!game.message) return;
        const retryCollector = game.message.createMessageComponentCollector({
          time: 120_000,
          max: 1,
          filter: (buttonInteraction) => buttonInteraction.customId === retryId,
        });

        retryCollector.on('collect', async (buttonInteraction) => {
          if (activeGames.has(gameKey(buttonInteraction.guildId, buttonInteraction.channelId))) {
            await buttonInteraction.reply({ content: 'A casino game is already active in this channel.', ephemeral: true });
            return;
          }
          await buttonInteraction.deferUpdate();
          await runHorseRaceGame(buttonInteraction, { initiatedByButton: true });
        });

        retryCollector.on('end', async () => {
          if (!game.message) return;
          try {
            await game.message.edit({
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId(retryId).setLabel('Try Again').setStyle(ButtonStyle.Secondary).setDisabled(true),
                ),
              ],
            });
          } catch (_) {}
        });
        return;
      }

      const raceMessage = await game.channel.send({
        embeds: [buildHorseRaceRunningEmbed(game, horses, 0)],
        allowedMentions: { parse: [] },
      });

      const finishOrder = [];
      for (let step = 1; step <= HORSE_RACE_PROGRESS_STEPS; step += 1) {
        await wait(HORSE_RACE_PROGRESS_UPDATE_MS);
        for (const horse of horses) {
          if (horse.finished) continue;
          const remaining = Math.max(0, (HORSE_RACE_TRACK_SLOTS - 1) - horse.position);
          const stepsLeft = Math.max(1, HORSE_RACE_PROGRESS_STEPS - step + 1);
          let advance = 0;
          if (step === HORSE_RACE_PROGRESS_STEPS) {
            advance = remaining;
          } else {
            const maxAllowed = Math.max(1, remaining - (stepsLeft - 1));
            advance = Math.min(maxAllowed, (Math.floor(Math.random() * 3) + 1));
          }
          horse.position += advance;
          if (horse.position >= HORSE_RACE_TRACK_SLOTS - 1) {
            horse.position = HORSE_RACE_TRACK_SLOTS - 1;
            horse.finished = true;
            horse.finishTick = step;
            finishOrder.push(horse);
          }
        }

        await raceMessage.edit({
          embeds: [buildHorseRaceRunningEmbed(game, horses, step)],
          allowedMentions: { parse: [] },
        });
      }

      if (finishOrder.length < horses.length) {
        const remaining = horses.filter((horse) => !finishOrder.includes(horse));
        remaining.sort((a, b) => b.position - a.position);
        finishOrder.push(...remaining);
      }

      const totalPot = horses.length * HORSE_RACE_ENTRY_COST;
      let firstPrize = 0;
      let secondPrize = 0;
      if (horses.length <= 3) {
        firstPrize = Math.max(0, totalPot - HORSE_RACE_ENTRY_COST);
      } else {
        firstPrize = Math.round(totalPot * 0.75);
        firstPrize = Math.max(1, Math.min(totalPot, firstPrize));
        secondPrize = Math.max(0, totalPot - firstPrize);
      }

      const payoutsByUser = new Map();
      if (finishOrder[0] && firstPrize > 0) {
        await rupeeStore.addTokens(game.guildId, finishOrder[0].userId, firstPrize);
        payoutsByUser.set(finishOrder[0].userId, firstPrize);
      }
      if (finishOrder[1] && secondPrize > 0) {
        await rupeeStore.addTokens(game.guildId, finishOrder[1].userId, secondPrize);
        payoutsByUser.set(finishOrder[1].userId, (payoutsByUser.get(finishOrder[1].userId) || 0) + secondPrize);
      }

      const roundStats = horses.map((horse) => {
        const amountWon = payoutsByUser.get(horse.userId) || 0;
        return {
          userId: horse.userId,
          amountBet: HORSE_RACE_ENTRY_COST,
          amountWon,
          net: amountWon - HORSE_RACE_ENTRY_COST,
          didWin: finishOrder[0]?.userId === horse.userId || (secondPrize > 0 && finishOrder[1]?.userId === horse.userId),
          didLose: !(finishOrder[0]?.userId === horse.userId || (secondPrize > 0 && finishOrder[1]?.userId === horse.userId)),
        };
      });
      try {
        casinoStatsStore.recordRound(game.guildId, 'horse_race', roundStats);
      } catch (statsError) {
        console.error('[Horse Race] Failed to record casino stats:', statsError);
      }

      const winner = finishOrder[0] || null;
      const second = finishOrder[1] || null;
      const third = finishOrder[2] || null;
      const winnerRecord = winner ? casinoStatsStore.getUserGameRecord(game.guildId, winner.userId, 'horse_race') : { wins: 0, losses: 0 };
      const secondRecord = second ? casinoStatsStore.getUserGameRecord(game.guildId, second.userId, 'horse_race') : { wins: 0, losses: 0 };
      const thirdRecord = third ? casinoStatsStore.getUserGameRecord(game.guildId, third.userId, 'horse_race') : { wins: 0, losses: 0 };

      const resultLines = [];
      if (winner) {
        resultLines.push(`🥇 - <@${winner.userId}> _Amount Won ${formatCurrencyAmount(game.guildId, firstPrize)}_ (New Record in ${winnerRecord.wins}-${winnerRecord.losses})`);
      }
      if (second) {
        const secondPrefix = horses.length <= 3 ? '2nd' : '🥈';
        const secondAmountText = secondPrize > 0 ? ` _Amount Won ${formatCurrencyAmount(game.guildId, secondPrize)}_` : '';
        resultLines.push(`${secondPrefix} - <@${second.userId}>${secondAmountText} (New Record in ${secondRecord.wins}-${secondRecord.losses})`);
      }
      if (third) {
        resultLines.push(`3rd - <@${third.userId}> (New Record in ${thirdRecord.wins}-${thirdRecord.losses})`);
      }

      const resultEmbed = buildHorseRaceResultEmbed(game, resultLines.length ? resultLines : ['No final results available.']);
      const playAgainId = `horserace-play-again-${Date.now()}`;
      await raceMessage.edit({
        embeds: [resultEmbed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(playAgainId).setLabel('Play Again').setStyle(ButtonStyle.Success),
          ),
        ],
        allowedMentions: { parse: [] },
      });

      activeGames.delete(key);
      gameDeleted = true;

      const playAgainCollector = raceMessage.createMessageComponentCollector({
        time: 120_000,
        max: 1,
        filter: (buttonInteraction) => buttonInteraction.customId === playAgainId,
      });

      playAgainCollector.on('collect', async (buttonInteraction) => {
        if (activeGames.has(gameKey(buttonInteraction.guildId, buttonInteraction.channelId))) {
          await buttonInteraction.reply({ content: 'A casino game is already active in this channel.', ephemeral: true });
          return;
        }
        await buttonInteraction.deferUpdate();
        await runHorseRaceGame(buttonInteraction, { initiatedByButton: true });
      });

      playAgainCollector.on('end', async () => {
        try {
          await raceMessage.edit({
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(playAgainId).setLabel('Play Again').setStyle(ButtonStyle.Secondary).setDisabled(true),
              ),
            ],
          });
        } catch (_) {}
      });
    } catch (error) {
      console.error('[Horse Race] Round close flow failed', { guildId: game.guildId, channelId: game.channel?.id, raceId: game.raceId }, error);
    } finally {
      if (!gameDeleted) {
        activeGames.delete(key);
      }
    }
  });
}

async function runCasinoStats(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Casino stats can only be viewed in a server channel.', ephemeral: true });
    return;
  }

  const summary = casinoStatsStore.getSummary(interaction.guildId);
  const guildId = interaction.guildId;

  const winnerText = summary.topWinner
    ? `<@${summary.topWinner.userId}> (${formatCurrencyAmount(guildId, summary.topWinner.amount, { lowercase: true })} won)`
    : '_No recorded winners yet._';

  const loserText = summary.topLoser
    ? `<@${summary.topLoser.userId}> (${formatCurrencyAmount(guildId, summary.topLoser.amount, { lowercase: true })} lost)`
    : '_No recorded losses yet._';

  const topGameText = summary.topGame
    ? [
      `Game: **${formatGameName(summary.topGame.game)}** (${formatCurrencyAmount(guildId, summary.topGame.totalPaidOut, { lowercase: true })} paid out)`,
      summary.topGame.topPayout?.userId
        ? `Top recipient: <@${summary.topGame.topPayout.userId}> (${formatCurrencyAmount(guildId, summary.topGame.topPayout.amount, { lowercase: true })})`
        : 'Top recipient: _None yet._',
    ].join('\n')
    : '_No casino rounds have been recorded yet._';

  const highestPayoutText = summary.highestPayout
    ? `${formatGameName(summary.highestPayout.game)} paid <@${summary.highestPayout.userId}> ${formatCurrencyAmount(guildId, summary.highestPayout.amount, { lowercase: true })}`
    : '_No payouts recorded yet._';

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0x06b6d4))
    .setTitle('Casino Stats')
    .addFields(
      { name: 'Most Won', value: winnerText },
      { name: 'Most Lost', value: loserText },
      { name: 'Top Paying Game', value: topGameText },
      { name: 'Highest Single Payout', value: highestPayoutText },
    )
    .setFooter({ text: `Tracked users: ${summary.usersTracked} | Tracked games: ${summary.gamesTracked}` });

  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Casino style games.')
    .addSubcommand((sub) =>
      sub
        .setName('roulette')
        .setDescription('Start an American roulette game lobby.'))
    .addSubcommand((sub) =>
      sub
        .setName('horserace')
        .setDescription('Start a horse race lobby with join and leave buttons.'))
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('View casino stats for this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'roulette') {
      await runRouletteGame(interaction);
      return;
    }
    if (sub === 'horserace') {
      await runHorseRaceGame(interaction);
      return;
    }
    if (sub === 'stats') {
      await runCasinoStats(interaction);
    }
  },
};
