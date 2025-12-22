const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { MAX_ANSWERS } = require('./openPollStore');

function computeVoteCounts(poll) {
  const answers = Array.isArray(poll?.answers) ? poll.answers : [];
  const counts = new Array(answers.length).fill(0);
  const voteByUser = poll?.voteByUser && typeof poll.voteByUser === 'object' ? poll.voteByUser : {};
  for (const idx of Object.values(voteByUser)) {
    const n = Number(idx);
    if (!Number.isInteger(n)) continue;
    if (n < 0 || n >= counts.length) continue;
    counts[n] += 1;
  }
  return counts;
}

function sanitiseNoMentions(text, maxLen) {
  return String(text || '')
    .trim()
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/@/g, '@\u200b')
    .replace(/#/g, '#\u200b')
    .replace(/&/g, '&\u200b')
    .slice(0, maxLen);
}

function buildAnswerLines(poll) {
  const answers = Array.isArray(poll?.answers) ? poll.answers : [];
  const safeAnswers = answers.slice(0, MAX_ANSWERS);
  const counts = computeVoteCounts(poll);
  return safeAnswers.map((a, idx) => {
    const text = sanitiseNoMentions(a?.text, 200) || '(blank)';
    const authorId = a?.authorId ? String(a.authorId) : null;
    const author = authorId ? `<@${authorId}>` : 'Unknown';
    const votes = Number.isInteger(counts[idx]) ? counts[idx] : 0;
    return `${idx + 1}. ${text} — ${author}  •  **${votes}** vote${votes === 1 ? '' : 's'}`;
  });
}

function chunkLinesToFields(lines) {
  if (!lines.length) return [];

  const fields = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 1024) {
      if (current) fields.push(current);
      current = line.slice(0, 1024);
    } else {
      current = next;
    }
    if (fields.length >= 24) break;
  }
  if (current && fields.length < 25) fields.push(current);
  return fields;
}

function buildPollEmbed(poll, guildId) {
  const question = sanitiseNoMentions(poll?.question, 300) || 'Untitled poll';
  const status = poll?.open === false ? 'Closed' : 'Open';
  const creatorId = poll?.creatorId ? String(poll.creatorId) : null;

  const embed = new EmbedBuilder()
    .setTitle('Open Poll')
    .setDescription(`**Question:** ${question}\n**Status:** ${status}${creatorId ? `\n**Creator:** <@${creatorId}>` : ''}`)
    .setTimestamp();

  try {
    const { applyDefaultColour } = require('./guildColourStore');
    applyDefaultColour(embed, guildId);
  } catch (_) {
    embed.setColor(0x5865f2);
  }

  const lines = buildAnswerLines(poll);
  if (!lines.length) {
    embed.addFields({
      name: `Answers (0/${MAX_ANSWERS})`,
      value: '_No answers yet. Click **Add Answer** to add one._',
      inline: false,
    });
    return embed;
  }

  const chunks = chunkLinesToFields(lines);
  chunks.forEach((value, idx) => {
    embed.addFields({
      name: idx === 0 ? `Answers (${lines.length}/${MAX_ANSWERS})` : 'Answers (cont.)',
      value,
      inline: false,
    });
  });

  return embed;
}

function buildPollComponents(poll) {
  const pollId = String(poll?.id || '');

  const addAnswer = new ButtonBuilder()
    .setCustomId(`openpoll:add:${pollId}`)
    .setLabel('Add Answer')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(poll?.open === false);

  const vote = new ButtonBuilder()
    .setCustomId(`openpoll:voteui:${pollId}:0`)
    .setLabel('Vote')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(poll?.open === false);

  const toggle = new ButtonBuilder()
    .setCustomId(`openpoll:toggle:${pollId}`)
    .setLabel(poll?.open === false ? 'Open Poll' : 'Close Poll')
    .setStyle(poll?.open === false ? ButtonStyle.Success : ButtonStyle.Danger);

  return [new ActionRowBuilder().addComponents(addAnswer, vote, toggle)];
}

function buildPollView(poll, guildId) {
  return {
    embeds: [buildPollEmbed(poll, guildId)],
    components: buildPollComponents(poll),
    allowedMentions: { parse: [] },
  };
}

async function updatePollMessage(client, poll) {
  const channelId = poll?.channelId ? String(poll.channelId) : null;
  const messageId = poll?.messageId ? String(poll.messageId) : null;
  const guildId = poll?.guildId ? String(poll.guildId) : null;

  if (!channelId || !messageId) return { ok: false, error: 'missing_message' };

  let channel = null;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (_) {}
  if (!channel || !channel.isTextBased?.()) return { ok: false, error: 'missing_channel' };

  try {
    await channel.messages.edit(messageId, buildPollView(poll, guildId));
  } catch (_) {
    return { ok: false, error: 'missing_message' };
  }
  return { ok: true };
}

function buildVoteUi(poll, guildId, userId, page = 0) {
  const pollId = String(poll?.id || '');
  const answers = Array.isArray(poll?.answers) ? poll.answers : [];
  const counts = computeVoteCounts(poll);
  const voteByUser = poll?.voteByUser && typeof poll.voteByUser === 'object' ? poll.voteByUser : {};
  const uid = String(userId || '');
  const currentVote = Number.isInteger(voteByUser[uid]) ? voteByUser[uid] : null;

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(answers.length / pageSize));
  const safePage = Number.isInteger(page) ? Math.min(Math.max(0, page), totalPages - 1) : 0;
  const start = safePage * pageSize;
  const end = Math.min(answers.length, start + pageSize);

  const question = sanitiseNoMentions(poll?.question, 300) || 'Untitled poll';

  const embed = new EmbedBuilder()
    .setTitle('Vote')
    .setDescription(
      `**Question:** ${question}\n` +
        `**Your vote:** ${
          Number.isInteger(currentVote) ? `#${currentVote + 1}` : '_None_'
        }\n` +
        `Page **${safePage + 1}/${totalPages}**`
    )
    .setTimestamp();

  try {
    const { applyDefaultColour } = require('./guildColourStore');
    applyDefaultColour(embed, guildId);
  } catch (_) {
    embed.setColor(0x5865f2);
  }

  if (!answers.length) {
    embed.addFields({
      name: 'Answers',
      value: '_No answers yet._',
      inline: false,
    });
  } else {
    const lines = [];
    for (let i = start; i < end; i++) {
      const text = sanitiseNoMentions(answers[i]?.text, 200) || '(blank)';
      const votes = Number.isInteger(counts[i]) ? counts[i] : 0;
      const marker = currentVote === i ? ' **(your vote)**' : '';
      lines.push(`#${i + 1}: ${text} — **${votes}** vote${votes === 1 ? '' : 's'}${marker}`);
    }
    const value = lines.join('\n').slice(0, 1024);
    embed.addFields({ name: 'Pick an answer', value, inline: false });
  }

  const components = [];

  if (answers.length) {
    const disabled = poll?.open === false;
    let row = new ActionRowBuilder();
    let inRow = 0;
    for (let i = start; i < end; i++) {
      const selected = currentVote === i;
      const btn = new ButtonBuilder()
        .setCustomId(`openpoll:cast:${pollId}:${i}:${safePage}`)
        .setLabel(String(i + 1))
        .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(disabled);

      row.addComponents(btn);
      inRow += 1;
      if (inRow === 5) {
        components.push(row);
        row = new ActionRowBuilder();
        inRow = 0;
      }
      if (components.length === 4) break;
    }
    if (inRow > 0 && components.length < 4) components.push(row);

    const prev = new ButtonBuilder()
      .setCustomId(`openpoll:voteui:${pollId}:${Math.max(0, safePage - 1)}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || safePage === 0);

    const next = new ButtonBuilder()
      .setCustomId(`openpoll:voteui:${pollId}:${Math.min(totalPages - 1, safePage + 1)}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || safePage >= totalPages - 1);

    const clear = new ButtonBuilder()
      .setCustomId(`openpoll:clear:${pollId}:${safePage}`)
      .setLabel('Clear Vote')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || !Number.isInteger(currentVote));

    components.push(new ActionRowBuilder().addComponents(prev, next, clear));
  }

  return {
    content: 'Vote for an answer by clicking its number.',
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
    ephemeral: true,
  };
}

module.exports = {
  buildPollView,
  updatePollMessage,
  buildVoteUi,
};
