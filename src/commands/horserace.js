const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} = require('discord.js');
const { recordRace } = require('../utils/horseRaceStore');
const rupeeStore = require('../utils/rupeeStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const TRACK_SLOTS = 80;
const TICK_DELAY_MS = 5_000;
const MAX_TICKS = TRACK_SLOTS * 2;
const JOIN_WINDOW_MS = 60_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const ENTRY_COST = 1;
const BET_COST = 1;
const PLACEMENT_REWARDS = [3, 2, 1];
const PLACE_EMOJIS = ['🥇', '🥈', '🥉'];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeEmbed(guildId, colorFallback = 0x00f0ff) {
  return new EmbedBuilder().setColor(resolveEmbedColour(guildId, colorFallback));
}

function renderTrack(position) {
  const slots = Math.max(12, TRACK_SLOTS);
  const finishIndex = slots - 1;
  const arr = Array(slots).fill('—');
  const clamped = Math.max(0, Math.min(position, finishIndex));
  arr[clamped] = '🏇';
  return `${arr.join('')}🏁`;
}

function renderRaceLines(horses, finishOrder, betTotals) {
  return horses.flatMap((horse, index) => {
    const lane = `\`${String(index + 1).padStart(2, '0')}\``;
    const track = renderTrack(horse.position);
    const nameRaw = horse.shortName || horse.name || `Horse ${index + 1}`;
    const safeName = escapeMarkdown(nameRaw).slice(0, 32);
    const label = horse.isPlayer ? `**${safeName}**` : safeName;
    const mentionLine = horse.userId ? `**<@${horse.userId}>**` : label;
    const placementIndex = finishOrder.indexOf(horse);
    let suffix = '';
    if (placementIndex !== -1) {
      suffix = ` ${PLACE_EMOJIS[placementIndex] ?? `#${placementIndex + 1}`}`;
    } else if (horse.finished) {
      const orderIndex = finishOrder.length + 1;
      suffix = ` #${orderIndex}`;
    } else if (horse.isPlayer) {
      suffix = ' ⭐';
    }
    const betCount = betTotals.get(horse.id) || 0;
    const betText = betCount > 0 ? ` · Bets: ${betCount}` : '';
    return [
      mentionLine,
      `${lane} ${track}${suffix}${betText}`,
    ];
  });
}

function summarizeBets(bets) {
  const betTotals = new Map();
  for (const bet of bets.values()) {
    if (!bet) continue;
    betTotals.set(bet.horseId, (betTotals.get(bet.horseId) || 0) + 1);
  }
  return {
    betTotals,
    totalBets: bets.size,
  };
}

function renderBettingSummary(horses, betTotals, totalBets) {
  if (!horses.length) return '_No racers yet._';
  const headline = totalBets > 0
    ? `**Bets — ${totalBets} rupee${totalBets === 1 ? '' : 's'} in play**`
    : '**Bets — No rupees in play yet**';

  const lines = horses.map((horse, index) => {
    const count = betTotals.get(horse.id) || 0;
    const nameRaw = horse.shortName || horse.name || `Horse ${index + 1}`;
    const safeName = escapeMarkdown(nameRaw).slice(0, 32);
    const betText = count === 0 ? 'No bets' : `${count} bet${count === 1 ? '' : 's'} (1💎 each)`;
    return `• \`${String(index + 1).padStart(2, '0')}\` ${safeName} — ${betText}`;
  });

  return `${headline}\n${lines.join('\n')}`;
}

function renderWaitingState(horses, joinDeadline, betTotals, totalBets) {
  const now = Date.now();
  const secondsLeft = Math.max(0, Math.ceil((joinDeadline - now) / 1000));
  const description = horses.length
    ? horses
      .map((horse, index) => {
        const nameRaw = horse.shortName || horse.name || `Horse ${index + 1}`;
        const safeName = escapeMarkdown(nameRaw).slice(0, 32);
        const label = horse.isPlayer ? `**${safeName}**` : safeName;
        return `\`${String(index + 1).padStart(2, '0')}\` ${label}`;
      })
      .join('\n')
    : '_No riders yet - invite some friends!_';

  return {
    description,
    countdown: `Race starts in ${secondsLeft}s (need ${MIN_PLAYERS}+ racers). Entry fee: ${ENTRY_COST} rupee.`,
    betting: renderBettingSummary(horses, betTotals, totalBets),
  };
}

function buildComponents(stage, participantCount, joinButtonId, betButtonId, startButtonId) {
  const joinDisabled = stage !== 'waiting' || participantCount >= MAX_PLAYERS;
  const betDisabled = stage !== 'waiting';
  const startDisabled = stage !== 'waiting' || participantCount < MIN_PLAYERS;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(joinButtonId)
      .setLabel('Join Race')
      .setStyle(ButtonStyle.Success)
      .setDisabled(joinDisabled),
    new ButtonBuilder()
      .setCustomId(betButtonId)
      .setLabel('Place Bet')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(betDisabled),
    new ButtonBuilder()
      .setCustomId(startButtonId)
      .setLabel('Start Race')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(startDisabled),
  );

  return [row];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('horserace')
    .setDescription('Start a left-to-right horse race featuring your own steed.'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      const embed = makeEmbed(interaction.guildId)
        .setTitle('Horse races need a server')
        .setDescription('Horse races can only be started inside a server channel.');
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const guildId = interaction.guildId;
    const raceId = `${interaction.id}-${Date.now()}`;
    const joinButtonId = `horserace-join-${raceId}`;
    const betButtonId = `horserace-bet-${raceId}`;
    const startButtonId = `horserace-start-${raceId}`;
    const raceStarterId = interaction.user.id;

    const participants = new Map();
    const horses = [];
    const finishOrder = [];
    const bets = new Map();
    const entryPayments = new Set();

    function registerParticipant(user) {
      if (participants.has(user.id)) {
        return participants.get(user.id);
      }
      const displayName = user.displayName || user.username || user.globalName || `Racer ${horses.length + 1}`;
      const horse = {
        id: user.id,
        userId: user.id,
        name: displayName,
        shortName: displayName,
        isPlayer: true,
        position: 0,
        finished: false,
        finishTick: Number.POSITIVE_INFINITY,
      };
      participants.set(user.id, horse);
      horses.push(horse);
      return horse;
    }

    const paid = await rupeeStore.spendTokens(guildId, interaction.user.id, ENTRY_COST);
    if (!paid) {
      const balance = rupeeStore.getBalance(guildId, interaction.user.id);
      const embed = makeEmbed(guildId)
        .setTitle('Not enough Rupees')
        .setDescription(
          `You need ${ENTRY_COST} rupee${ENTRY_COST === 1 ? '' : 's'} to start a horse race.\n` +
          `Current balance: ${balance}.`
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    entryPayments.add(interaction.user.id);

    registerParticipant({
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.member?.displayName,
      globalName: interaction.user.globalName,
    });

    let joinDeadline = Date.now() + JOIN_WINDOW_MS;
    let stage = 'waiting';
    let currentTick = 0;
    let finalSummaryEmbed = null;

    await interaction.deferReply();

    const buildAndSend = async () => {
      try {
        const { betTotals, totalBets } = summarizeBets(bets);
        let embed;
        if (stage === 'waiting') {
          const waiting = renderWaitingState(horses, joinDeadline, betTotals, totalBets);
          embed = makeEmbed(guildId)
            .setTitle('🏇 Horse Race Lobby')
            .setDescription(waiting.description)
            .addFields(
              { name: 'Start timer', value: waiting.countdown, inline: false },
              { name: 'Bets', value: waiting.betting, inline: false },
            )
            .setFooter({ text: `Entry cost: ${ENTRY_COST} rupee • Bets cost: ${BET_COST} rupee each` });
        } else if (stage === 'cancelled') {
          const refunds = [];
          if (entryPayments.size > 0) refunds.push('entry fees');
          if (bets.size > 0) refunds.push('bets');
          const refundNote = refunds.length ? `Refunded ${refunds.join(' and ')}.` : '';
          embed = makeEmbed(guildId)
            .setTitle('🏇 Horse Race Cancelled')
            .setDescription(
              `Not enough racers joined in time (need at least ${MIN_PLAYERS}).\n${refundNote || 'No charges were made.'}`
            );
        } else {
          const raceLines = renderRaceLines(horses, finishOrder, betTotals);
          const title = stage === 'finished'
            ? '🏁 Horse Race — Final Standings'
            : `🏇 Horse Race — Turn ${currentTick}`;
          embed = makeEmbed(guildId)
            .setTitle(title)
            .setDescription(raceLines.join('\n'));

          if (stage !== 'finished') {
            embed.addFields({ name: 'Bets', value: renderBettingSummary(horses, betTotals, totalBets) });
        embed.setFooter({ text: 'Live updates every 5 seconds' });
          } else if (finalSummaryEmbed) {
            embed = finalSummaryEmbed;
          }
        }

        await interaction.editReply({
          embeds: [embed],
          components: buildComponents(stage, horses.length, joinButtonId, betButtonId, startButtonId),
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        console.error('Failed to update horserace message:', err);
      }
    };

    await buildAndSend();

    const collector = (await interaction.fetchReply()).createMessageComponentCollector({
      time: JOIN_WINDOW_MS + (MAX_TICKS * TICK_DELAY_MS) + 120_000,
    });

    const joinInterval = setInterval(() => {
      if (stage !== 'waiting') return;
      if (Date.now() >= joinDeadline) return;
      buildAndSend();
    }, 5_000);

    collector.on('collect', async (componentInteraction) => {
      if (componentInteraction.customId === joinButtonId) {
        if (stage !== 'waiting') {
          const embed = makeEmbed(guildId).setTitle('Race already started').setDescription('The race has already started!');
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        if (horses.length >= MAX_PLAYERS) {
          const embed = makeEmbed(guildId).setTitle('Roster full').setDescription('The roster is full!');
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        if (participants.has(componentInteraction.user.id)) {
          const embed = makeEmbed(guildId).setTitle('Already entered').setDescription('You are already entered in this race.');
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        if (!(await rupeeStore.spendTokens(guildId, componentInteraction.user.id, ENTRY_COST))) {
          const balance = rupeeStore.getBalance(guildId, componentInteraction.user.id);
          const embed = makeEmbed(guildId)
            .setTitle('Not enough Rupees')
            .setDescription(
              `Joining a race costs ${ENTRY_COST} rupee. You have ${balance}.\nEarn more and try again!`
            );
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        entryPayments.add(componentInteraction.user.id);
        registerParticipant({
          id: componentInteraction.user.id,
          username: componentInteraction.user.username,
          displayName: componentInteraction.member?.displayName,
          globalName: componentInteraction.user.globalName,
        });
        const joinEmbed = makeEmbed(guildId)
          .setTitle('You joined the race!')
          .setDescription(`A rupee has been deducted. Good luck, ${componentInteraction.user.displayName || componentInteraction.user.username}!`);
        await componentInteraction.reply({ embeds: [joinEmbed], ephemeral: true });
        await buildAndSend();
      } else if (componentInteraction.customId === betButtonId) {
        if (stage === 'finished') {
          const embed = makeEmbed(guildId)
            .setTitle('Betting closed')
            .setDescription('The race is already over.');
          await componentInteraction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        const modalCustomId = `horserace-bet-modal-${raceId}-${componentInteraction.user.id}`;
        const modal = new ModalBuilder()
          .setTitle('Place a Bet')
          .setCustomId(modalCustomId)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('horseNumber')
                .setLabel('Horse number (lane)')
                .setPlaceholder('Enter a number between 1 and ' + horses.length)
                .setRequired(true)
                .setStyle(TextInputStyle.Short),
            ),
          );

        try {
          await componentInteraction.showModal(modal);
          const submission = await componentInteraction.awaitModalSubmit({
            time: 60_000,
            filter: (i) => i.customId === modalCustomId && i.user.id === componentInteraction.user.id,
          });

          const horseNumberRaw = submission.fields.getTextInputValue('horseNumber');
          const horseNumber = Number.parseInt(horseNumberRaw, 10);

          if (!Number.isInteger(horseNumber) || horseNumber < 1 || horseNumber > horses.length) {
            const embed = makeEmbed(guildId)
              .setTitle('Invalid horse number')
              .setDescription(`Please enter a valid horse number between 1 and ${horses.length}.`);
            await submission.reply({ embeds: [embed], ephemeral: true });
            return;
          }

          const targetHorse = horses[horseNumber - 1];
          const existing = bets.get(submission.user.id);
          if (!existing) {
            const paid = await rupeeStore.spendTokens(guildId, submission.user.id, BET_COST);
            if (!paid) {
              const balance = rupeeStore.getBalance(guildId, submission.user.id);
              const embed = makeEmbed(guildId)
                .setTitle('Not enough Rupees')
                .setDescription(
                  `Placing a bet costs ${BET_COST} rupee. Your balance is ${balance}.\n` +
                  'Earn another rupee and try again.'
                );
              await submission.reply({ embeds: [embed], ephemeral: true });
              return;
            }
          }

          bets.set(submission.user.id, { horseId: targetHorse.id });

          const embed = makeEmbed(guildId)
            .setTitle('Bet placed')
            .setDescription(
              `You placed 1 rupee on **${escapeMarkdown(targetHorse.shortName || targetHorse.name)}**.\n` +
              'If they win, you gain +1 rupee profit and get your bet back.'
            );
          await submission.reply({ embeds: [embed], ephemeral: true });
          await buildAndSend();
        } catch (err) {
          if (err?.code === 'INTERACTION_COLLECTOR_ERROR') return;
          if (err?.message?.includes('Collector received no interactions')) return;
          console.error('Failed to process bet modal:', err);
      }
    }
    } else if (componentInteraction.customId === startButtonId) {
      if (stage !== 'waiting') {
        const embed = makeEmbed(guildId)
          .setTitle('Race already started')
          .setDescription('The race has already started and cannot be started again.');
        await componentInteraction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      if (componentInteraction.user.id !== raceStarterId) {
        const embed = makeEmbed(guildId)
          .setTitle('Only the lobby owner can start the race')
          .setDescription('You must be the user who opened this race lobby to trigger the early start.');
        await componentInteraction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      if (!componentInteraction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        const embed = makeEmbed(guildId)
          .setTitle('Admin-only control')
          .setDescription('Only a server administrator can manually start the race.');
        await componentInteraction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      if (horses.length < MIN_PLAYERS) {
        const embed = makeEmbed(guildId)
          .setTitle('Not enough racers')
          .setDescription(`You need at least ${MIN_PLAYERS} racers before the race can begin.`);
        await componentInteraction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      stage = 'running';
      joinDeadline = Date.now();
      await componentInteraction.deferUpdate();
      await buildAndSend();
    }
  });

    collector.on('end', () => {
      clearInterval(joinInterval);
    });

    const waitForJoinPhase = async () => {
      while (Date.now() < joinDeadline && stage === 'waiting') {
        await wait(1_000);
      }
    };

    await waitForJoinPhase();

    if (horses.length < MIN_PLAYERS) {
      stage = 'cancelled';

      for (const userId of entryPayments) {
        await rupeeStore.addTokens(guildId, userId, ENTRY_COST);
      }
      for (const [userId, bet] of bets.entries()) {
        if (!bet) continue;
        await rupeeStore.addTokens(guildId, userId, BET_COST);
      }

      await buildAndSend();
      collector.stop('not_enough_players');
      return;
    }

    stage = 'running';

    await buildAndSend();

    const sendLiveUpdate = async () => {
      try {
        const { betTotals, totalBets } = summarizeBets(bets);
        const raceLines = renderRaceLines(horses, finishOrder, betTotals);
        const embed = makeEmbed(guildId)
          .setTitle(`🏇 Horse Race — Turn ${currentTick}`)
          .setDescription(raceLines.join('\n'))
          .addFields({ name: 'Bets', value: renderBettingSummary(horses, betTotals, totalBets) })
          .setFooter({ text: 'Live updates every 5 seconds' });
        await interaction.followUp({ embeds: [embed], allowedMentions: { parse: [] } });
      } catch (err) {
        console.error('Failed to send live race update:', err);
      }
    };

    for (let tick = 1; tick <= MAX_TICKS; tick += 1) {
      currentTick = tick;
      for (const horse of horses) {
        if (horse.finished) continue;
        const advance = Math.floor(Math.random() * 3) + 1; // 1-3 steps per tick
        horse.position += advance;
        if (horse.position >= TRACK_SLOTS - 1) {
          horse.position = TRACK_SLOTS - 1;
          horse.finished = true;
          horse.finishTick = tick;
          finishOrder.push(horse);
        }
      }

      await sendLiveUpdate();
      if (horses.every((horse) => horse.finished)) {
        break;
      }
      if (tick < MAX_TICKS) {
        await wait(TICK_DELAY_MS);
      }
    }

    if (finishOrder.length < horses.length) {
      const remaining = horses.filter(h => !finishOrder.includes(h));
      remaining.sort((a, b) => b.position - a.position);
      finishOrder.push(...remaining);
    }

    stage = 'finished';

    const winningHorse = finishOrder[0];
    const winners = [];
    const losers = [];

    for (const [userId, bet] of bets.entries()) {
      if (!bet) continue;
      const isWinner = bet.horseId === winningHorse.id;
      if (isWinner) {
        await rupeeStore.addTokens(guildId, userId, 2); // 1 profit + 1 refunded
        winners.push(`- <@${userId}> won and earned +1 rupee (bet refunded).`);
      } else {
        losers.push(`- <@${userId}> lost their 1 rupee bet.`);
      }
    }

    const playerStatsByUserId = new Map();

    const playerSummaryLines = [];
    for (const horse of horses) {
      if (!horse.isPlayer || !horse.userId) continue;
      const placementIndex = finishOrder.indexOf(horse);
      const placementNumber = placementIndex === -1 ? null : placementIndex + 1;
      const stats = recordRace(guildId, horse.userId, placementNumber);
      playerStatsByUserId.set(horse.userId, stats);
      const placementLabel = placementNumber
        ? PLACE_EMOJIS[placementIndex] ?? `#${placementNumber}`
        : '#?';
      const reward = placementNumber ? PLACEMENT_REWARDS[placementIndex] || 0 : 0;
      if (reward > 0) {
        await rupeeStore.addTokens(guildId, horse.userId, reward);
      }
      const rewardText = reward > 0 ? ` (+${reward} rupee${reward === 1 ? '' : 's'})` : '';
      playerSummaryLines.push(
        `- **${escapeMarkdown(horse.shortName || horse.name)}** ${placementLabel}${rewardText} — 🥇 ${stats.first ?? 0} · 🥈 ${stats.second ?? 0} · 🥉 ${stats.third ?? 0} (Races: ${stats.races ?? 0})`,
      );
    }

    const podiumLines = finishOrder.slice(0, 3).map((horse, idx) => {
      const placeLabel = idx === 0 ? '1st Place' : idx === 1 ? '2nd Place' : '3rd Place';
      if (!horse) return `${placeLabel} - TBD`;
      const name = horse.isPlayer ? `<@${horse.userId}>` : escapeMarkdown(horse.name);
      return `${placeLabel} - ${name}`;
    });

    const winnersEmbed = makeEmbed(guildId)
      .setTitle('🏁 Horse Race - Winners')
      .setDescription(podiumLines.join('\n'));

    if (playerSummaryLines.length) {
      winnersEmbed.addFields({ name: 'Player stats', value: playerSummaryLines.join('\n') });
    }
    if (bets.size > 0) {
      winnersEmbed.addFields({
        name: 'Bets',
        value: winners.length ? winners.join('\n') : '_No winning bets this time._',
      });
      if (losers.length) {
        winnersEmbed.addFields({ name: 'Lost bets', value: losers.join('\n') });
      }
    }

    finalSummaryEmbed = winnersEmbed;

    await interaction.followUp({ embeds: [winnersEmbed], allowedMentions: { parse: [] } });
    await buildAndSend();
    collector.stop('finished');
  },
};
