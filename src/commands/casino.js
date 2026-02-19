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
    const payload = { content: 'A roulette game is already active in this channel.', ephemeral: true };
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
          await buttonInteraction.reply({ content: 'A roulette game is already active.', ephemeral: true });
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
        .setName('stats')
        .setDescription('View casino stats for this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'roulette') {
      await runRouletteGame(interaction);
      return;
    }
    if (sub === 'stats') {
      await runCasinoStats(interaction);
    }
  },
};
