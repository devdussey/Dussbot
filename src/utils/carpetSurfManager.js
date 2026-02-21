const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const carpetSurfConfigStore = require('./carpetSurfConfigStore');
const rupeeStore = require('./rupeeStore');
const { resolveEmbedColour } = require('./guildColourStore');
const { formatCurrencyAmount } = require('./currencyName');

const ROUND_DURATION_MS = 15_000;
const REWARD_AMOUNT = 1;
function getAssetRootCandidates() {
  const fromModuleDir = path.join(__dirname, '..', 'assets', 'carpetsurf');
  const fromSrcRoot = path.join(process.cwd(), 'src', 'assets', 'carpetsurf');
  const fromDistRoot = path.join(process.cwd(), 'dist', 'assets', 'carpetsurf');
  const fromRepoRoot = path.join(process.cwd(), 'assets', 'carpetsurf');
  const fromEnv = process.env.CARPETSURF_ASSET_ROOT ? path.resolve(process.env.CARPETSURF_ASSET_ROOT) : null;
  return [...new Set([fromEnv, fromModuleDir, fromSrcRoot, fromDistRoot, fromRepoRoot].filter(Boolean))];
}

function resolveAssetRoot() {
  const candidates = getAssetRootCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] || path.join(process.cwd(), 'src', 'assets', 'carpetsurf');
}

function formatAssetPathForMessage(targetPath) {
  const rel = path.relative(process.cwd(), targetPath);
  if (!rel || rel.startsWith('..')) return targetPath;
  return rel.replace(/\\/g, '/');
}

const ASSET_ROOT = resolveAssetRoot();
const CORRECT_UNMARKED_DIR = path.join(ASSET_ROOT, 'correct', 'unmarked');
const CORRECT_MARKED_DIR = path.join(ASSET_ROOT, 'correct', 'marked');
const INCORRECT_DIR = path.join(ASSET_ROOT, 'incorrect');
const VALID_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const timers = new Map();
const activeRounds = new Map();

function getTimerKey(guildId) {
  return String(guildId || '');
}

function isImageFile(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return VALID_IMAGE_EXTENSIONS.has(ext);
}

function listImageFiles(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && isImageFile(entry.name))
      .map(entry => path.join(dirPath, entry.name));
  } catch (_) {
    return [];
  }
}

function getAssetCounts() {
  return {
    correctUnmarked: listImageFiles(CORRECT_UNMARKED_DIR).length,
    correctMarked: listImageFiles(CORRECT_MARKED_DIR).length,
    incorrect: listImageFiles(INCORRECT_DIR).length,
  };
}

function shuffle(items) {
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

function pickIncorrectFiles(files, amount) {
  if (!Array.isArray(files) || !files.length || amount <= 0) return [];
  return shuffle(files).slice(0, amount);
}

function toStem(filePath) {
  const parsed = path.parse(String(filePath || ''));
  return String(parsed.name || '').toLowerCase();
}

function findMarkedMatch(unmarkedFilePath, markedFiles) {
  const stem = toStem(unmarkedFilePath);
  if (!stem || !Array.isArray(markedFiles) || !markedFiles.length) return null;
  return markedFiles.find(filePath => toStem(filePath) === stem) || null;
}

function buildButtons(roundId, { disabled = false } = {}) {
  const row = new ActionRowBuilder();
  for (let i = 0; i < 4; i += 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`carpetsurf:guess:${roundId}:${i}`)
        .setLabel(`Picture ${i + 1}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(Boolean(disabled)),
    );
  }
  return [row];
}

function getRoundKey(guildId) {
  return String(guildId || '');
}

function stopTimer(guildId) {
  const key = getTimerKey(guildId);
  const timer = timers.get(key);
  if (!timer) return;
  clearInterval(timer);
  timers.delete(key);
}

async function resolveChannel(client, guildId, channelId) {
  if (!client || !guildId || !channelId) return null;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    channel = await guild.channels.fetch(channelId).catch(() => null);
  }
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

async function awardWinners(guildId, winners) {
  if (!guildId || !Array.isArray(winners) || !winners.length) return;
  for (const userId of winners) {
    // eslint-disable-next-line no-await-in-loop
    await rupeeStore.addTokens(guildId, userId, REWARD_AMOUNT).catch(() => {});
  }
}

async function runRound(client, guildId) {
  const guildKey = getRoundKey(guildId);
  if (activeRounds.has(guildKey)) return { ok: false, error: 'A round is already running in this server.' };

  const config = carpetSurfConfigStore.getConfig(guildId);
  if (!config.enabled || !config.channelId) {
    return { ok: false, error: 'CarpetSurf is not enabled for this server.' };
  }

  const channel = await resolveChannel(client, guildId, config.channelId);
  if (!channel) return { ok: false, error: 'Configured channel could not be found.' };

  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel)
    || !perms?.has(PermissionFlagsBits.SendMessages)
    || !perms?.has(PermissionFlagsBits.EmbedLinks)
    || !perms?.has(PermissionFlagsBits.AttachFiles)) {
    return { ok: false, error: 'Missing required permissions in the configured channel.' };
  }

  const correctUnmarkedFiles = listImageFiles(CORRECT_UNMARKED_DIR);
  const correctMarkedFiles = listImageFiles(CORRECT_MARKED_DIR);
  const incorrectFiles = listImageFiles(INCORRECT_DIR);
  if (!correctUnmarkedFiles.length) {
    return { ok: false, error: `No images found in ${formatAssetPathForMessage(CORRECT_UNMARKED_DIR)}.` };
  }
  if (incorrectFiles.length < 3) {
    return { ok: false, error: `At least 3 images are required in ${formatAssetPathForMessage(INCORRECT_DIR)}.` };
  }

  const correctUnmarkedFile = pickRandom(correctUnmarkedFiles);
  const correctMarkedFile = findMarkedMatch(correctUnmarkedFile, correctMarkedFiles);
  const selectedIncorrect = pickIncorrectFiles(incorrectFiles, 3);
  if (!correctUnmarkedFile || selectedIncorrect.length < 3) {
    return { ok: false, error: 'Unable to build a valid round from assets.' };
  }

  const entries = shuffle([
    { type: 'correct', filePath: correctUnmarkedFile },
    ...selectedIncorrect.map(filePath => ({ type: 'incorrect', filePath })),
  ]);
  const correctIndex = entries.findIndex(entry => entry.type === 'correct');
  if (correctIndex < 0) return { ok: false, error: 'Unable to determine answer slot.' };

  const roundId = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const files = entries.map((entry, index) => {
    const ext = path.extname(entry.filePath).toLowerCase() || '.png';
    const name = `carpetsurf-${index + 1}${ext}`;
    return new AttachmentBuilder(entry.filePath, { name });
  });

  const embed = new EmbedBuilder()
    .setColor(resolveEmbedColour(guildId, 0xF1C40F))
    .setTitle('Find the piece!')
    .setDescription(`Where is the piece?\nClick the correct picture below. You have **15 seconds**.\nCorrect answer: **${formatCurrencyAmount(guildId, REWARD_AMOUNT)}**.`);

  const message = await channel.send({
    embeds: [embed],
    files,
    components: buildButtons(roundId),
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!message) return { ok: false, error: 'Failed to send the CarpetSurf round.' };

  const guesses = new Map();
  const round = {
    guildId,
    roundId,
    correctIndex,
    guesses,
    message,
    collector: null,
  };
  activeRounds.set(guildKey, round);

  const collector = message.createMessageComponentCollector({
    time: ROUND_DURATION_MS,
    filter: (interaction) => interaction.customId.startsWith(`carpetsurf:guess:${roundId}:`),
  });
  round.collector = collector;

  collector.on('collect', async (interaction) => {
    const parts = interaction.customId.split(':');
    const guessedSlot = Number(parts[3]);
    if (!Number.isInteger(guessedSlot) || guessedSlot < 0 || guessedSlot > 3) {
      await interaction.reply({ content: 'Invalid guess.', ephemeral: true }).catch(() => {});
      return;
    }

    if (guesses.has(interaction.user.id)) {
      await interaction.reply({ content: 'You already guessed this round.', ephemeral: true }).catch(() => {});
      return;
    }

    guesses.set(interaction.user.id, guessedSlot);
    await interaction.reply({ content: `Guess locked in: Picture ${guessedSlot + 1}.`, ephemeral: true }).catch(() => {});
  });

  collector.on('end', async () => {
    activeRounds.delete(guildKey);
    const winners = Array.from(guesses.entries())
      .filter(([, slot]) => slot === correctIndex)
      .map(([userId]) => userId);
    await awardWinners(guildId, winners);

    const resultLines = [];
    resultLines.push(`Time is up. The correct answer was **Picture ${correctIndex + 1}**.`);
    if (!winners.length) {
      resultLines.push('No correct guesses this round.');
    } else {
      resultLines.push(`Winners (${winners.length}): ${winners.map(userId => `<@${userId}>`).join(', ')}`);
      resultLines.push(`Each winner received ${formatCurrencyAmount(guildId, REWARD_AMOUNT)}.`);
    }
    if (correctMarkedFile) {
      resultLines.push('Outlined answer image attached below.');
    }

    const resultEmbed = new EmbedBuilder()
      .setColor(resolveEmbedColour(guildId, winners.length ? 0x57F287 : 0xED4245))
      .setTitle('CarpetSurf Results')
      .setDescription(resultLines.join('\n'));

    await message.edit({
      components: buildButtons(roundId, { disabled: true }),
    }).catch(() => {});

    const resultPayload = {
      embeds: [resultEmbed],
      allowedMentions: { users: winners, parse: [] },
    };
    if (correctMarkedFile) {
      const ext = path.extname(correctMarkedFile).toLowerCase() || '.png';
      resultPayload.files = [new AttachmentBuilder(correctMarkedFile, { name: `carpetsurf-answer${ext}` })];
    }

    await channel.send(resultPayload).catch(() => {});
  });

  return { ok: true, roundId };
}

async function runRoundSafe(client, guildId) {
  try {
    await runRound(client, guildId);
  } catch (err) {
    console.warn(`CarpetSurf round failed for guild ${guildId}:`, err?.message || err);
  }
}

async function reloadGuild(client, guildId) {
  stopTimer(guildId);
  const config = carpetSurfConfigStore.getConfig(guildId);
  if (!config.enabled || !config.channelId) return;

  const intervalMs = Math.max(60_000, Number(config.intervalMinutes || 60) * 60_000);
  const key = getTimerKey(guildId);
  const timer = setInterval(() => {
    runRoundSafe(client, guildId);
  }, intervalMs);
  timers.set(key, timer);
}

async function startAll(client) {
  const guildIds = Array.from(client.guilds.cache.keys());
  for (const guildId of guildIds) {
    // eslint-disable-next-line no-await-in-loop
    await reloadGuild(client, guildId);
  }
}

async function runNow(client, guildId) {
  return runRound(client, guildId);
}

module.exports = {
  startAll,
  reloadGuild,
  runNow,
  getAssetCounts,
};
