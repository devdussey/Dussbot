const { SlashCommandBuilder, ChannelType } = require('discord.js');
// node-fetch v3 is ESM-only; dynamic import for CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { createFieldEmbeds } = require('../utils/embedFields');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API;
const OPENAI_SUMMARIZE_MODEL = process.env.OPENAI_SUMMARIZE_MODEL
  || process.env.CHAT_MODEL
  || 'gpt-4o-mini';

const MAX_INPUT_CHARS = 16000; // practical cap before sending to API

const SUMMARY_LENGTH_PROMPTS = {
  short: 'Keep the response very concise: 2-3 clear bullet points and a paragraph of about 2 sentences.',
  medium: 'Provide 3-5 bullet points and a paragraph of roughly 3 sentences, highlighting the most important themes.',
  detailed: 'Give 5-7 bullet points and a 4-5 sentence paragraph with a touch more context and nuance.',
};

function buildSummarySections(text) {
  if (!text) return [];

  const sections = [];
  const lines = String(text).split(/\r?\n/);
  let currentName = null;
  let buffer = [];

  const flush = () => {
    if (!currentName) return;
    const value = buffer.join('\n').trim();
    if (value) {
      sections.push({ name: currentName, value });
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? '';
    const headingMatch = line.match(/^\s*([^:]{2,}):\s*$/);
    if (headingMatch) {
      flush();
      currentName = headingMatch[1].trim();
      continue;
    }

    if (!currentName) {
      currentName = 'Summary';
    }
    buffer.push(line);
  }

  flush();
  return sections.length ? sections : [{ name: 'Summary', value: String(text) }];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize the last N messages in this channel (bullets + paragraph)')
    .addIntegerOption(opt =>
      opt.setName('count')
        .setDescription('How many recent messages to analyze (max 300)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(300)
    )
    .addStringOption(opt =>
      opt.setName('length')
        .setDescription('Desired summary length')
        .addChoices(
          { name: 'short', value: 'short' },
          { name: 'medium', value: 'medium' },
          { name: 'detailed', value: 'detailed' },
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    // Try to defer; if another instance already acknowledged, quietly bail.
    try {
      await interaction.deferReply();
    } catch (e) {
      const code = e?.code || e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (code === 40060 || code === 10062 || msg.includes('already been acknowledged') || msg.includes('unknown interaction')) {
        return; // another process handled this interaction
      }
      throw e;
    }

    if (!OPENAI_API_KEY) {
      return interaction.editReply('OpenAI API key not configured. Set OPENAI_API_KEY in your environment to use /summarize.');
    }

    const count = interaction.options.getInteger('count') ?? 50;
    const lengthPref = interaction.options.getString('length') || 'short';

    // Ensure we're in a text-capable channel
    const channel = interaction.channel;
    if (!channel || ![
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.GuildAnnouncement
    ].includes(channel.type)) {
      return interaction.editReply('This command can only run in a text channel or thread.');
    }

    // Fetch recent messages, up to 1000 with pagination
    const target = Math.min(300, Math.max(1, count));
    let collected = [];
    let before;
    try {
      while (collected.length < target) {
        const limit = Math.min(100, target - collected.length);
        const batch = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
        if (!batch || batch.size === 0) break;
        const arr = [...batch.values()];
        collected.push(...arr);
        // Set cursor to the oldest message from this batch
        const oldest = arr.reduce((acc, m) => (!acc || m.createdTimestamp < acc.createdTimestamp) ? m : acc, null);
        before = oldest?.id;
      }
    } catch (err) {
      return interaction.editReply(`Could not fetch recent messages: ${err.message}`);
    }

    if (!collected.length) {
      return interaction.editReply('No recent messages found to summarize.');
    }

    // Build a plain-text transcript from oldest -> newest
    const ordered = collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const sanitize = (s) => {
      if (!s) return '';
      // Replace user/channel/role mentions with readable forms
      return String(s)
        .replace(/<@!?(\d+)>/g, '[@$1]')
        .replace(/<@&(\d+)>/g, '[@role:$1]')
        .replace(/<#(\d+)>/g, '[#channel:$1]');
    };

    let transcript = '';
    for (const m of ordered) {
      const name = m.member?.displayName || m.author?.username || 'Unknown';
      const author = m.author?.bot ? `${name} [bot]` : name;
      const content = sanitize(m.content);
      const attachments = m.attachments?.size ? ` [attachments: ${[...m.attachments.values()].map(a => a.name).filter(Boolean).join(', ')}]` : '';
      const line = content?.trim() ? `${author}: ${content}${attachments}` : (attachments ? `${author}:${attachments}` : '');
      if (line) transcript += `${line}\n`;
      // Stop if transcript is getting very large
      if (transcript.length > MAX_INPUT_CHARS * 1.5) break;
    }

    if (!transcript.trim()) {
      return interaction.editReply('Recent messages have no textual content to summarize.');
    }

    // Truncate to reasonable size
    let truncated = transcript.trim();
    let truncatedNote = '';
    if (truncated.length > MAX_INPUT_CHARS) {
      truncated = truncated.slice(0, MAX_INPUT_CHARS);
      truncatedNote = `\n\n(Note: Input truncated to ${MAX_INPUT_CHARS} characters for processing.)`;
    }

    try {
      const lengthInstruction = SUMMARY_LENGTH_PROMPTS[lengthPref] || SUMMARY_LENGTH_PROMPTS.medium;
      const systemPrompt = [
        'You are a concise summarization assistant.',
        'Output must begin with "Bulleted Summary:" followed by bullet lines that start with "-" and no additional text on that heading line.',
        'After the bullet section, include a blank line and then "Paragraph Summary:" followed by a short paragraph.',
        'Do not invent headings beyond those two and focus only on the most important information.',
      ].join(' ');

      const userPrompt = [
        `Length preference: ${lengthPref}. ${lengthInstruction}`,
        'Transcript:',
        truncated,
      ].join('\n\n');

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_SUMMARIZE_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      });

      const text = await resp.text();
      if (!resp.ok) {
        let msg = text;
        try { msg = JSON.parse(text)?.error?.message || msg; } catch (_) {}
        throw new Error(msg);
      }

      const data = JSON.parse(text);
      const summary = data?.choices?.[0]?.message?.content?.trim();
      if (!summary) throw new Error('No summary returned.');

      const sections = buildSummarySections(summary);
      const embeds = createFieldEmbeds({
        guildId: interaction.guildId,
        title: 'Channel Summary',
        user: interaction.user,
        description: truncatedNote ? truncatedNote.trim() : undefined,
        sections,
      }).map(embed => embed.toJSON());

      if (!embeds.length) {
        return interaction.editReply('Summary was empty.');
      }

      const [first, ...rest] = embeds;
      await interaction.editReply({ embeds: [first] });
      for (const embed of rest) {
        try { await interaction.followUp({ embeds: [embed] }); } catch (_) {}
      }
    } catch (err) {
      const msg = err?.message || String(err);
      try {
        await interaction.editReply(`Failed to summarize: ${msg}`);
      } catch (_) {
        try { await interaction.followUp({ content: `Failed to summarize: ${msg}` }); } catch (_) {}
      }
    }
  },
};
