import path from 'node:path';
import { ChannelType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

const fetch = globalThis.fetch;

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const { createFieldEmbeds } = requireFromSrcIfNeeded('../utils/embedFields');
const { isCategoryEnabled, shouldReplyEphemeral, areRepliesPublic } = requireFromSrcIfNeeded('../utils/botConfigStore');

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API;
const openaiSummarizeModel = process.env.OPENAI_SUMMARIZE_MODEL || process.env.CHAT_MODEL || 'gpt-4o-mini';
const maxInputChars = 16000;

const summaryLengthPrompts: Record<string, string> = {
  short: 'Keep the response very concise: 2-3 clear bullet points and a paragraph of about 2 sentences.',
  medium: 'Provide 3-5 bullet points and a paragraph of roughly 3 sentences, highlighting the most important themes.',
  detailed: 'Give 5-7 bullet points and a 4-5 sentence paragraph with a touch more context and nuance.',
};

function buildSummarySections(text: string) {
  if (!text) return [];
  const sections: Array<{ name: string; value: string }> = [];
  const lines = String(text).split(/\r?\n/);
  let currentName: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentName) return;
    const value = buffer.join('\n').trim();
    if (value) sections.push({ name: currentName, value });
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
    if (!currentName) currentName = 'Summary';
    buffer.push(line);
  }
  flush();
  return sections.length ? sections : [{ name: 'Summary', value: String(text) }];
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize the last N messages in this channel (bullets + paragraph)')
    .addIntegerOption((opt) =>
      opt.setName('count')
        .setDescription('How many recent messages to analyze (max 1500)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(1500))
    .addStringOption((opt) =>
      opt.setName('length')
        .setDescription('Desired summary length')
        .addChoices(
          { name: 'short', value: 'short' },
          { name: 'medium', value: 'medium' },
          { name: 'detailed', value: 'detailed' },
        )
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isCategoryEnabled(interaction.guildId, 'ai', true)) {
      const ephemeral = shouldReplyEphemeral(interaction.guildId, 'ai', true);
      return interaction.reply({ content: 'AI commands are disabled by a server admin.', ephemeral });
    }

    const preferPublic = areRepliesPublic(interaction.guildId, 'ai', false);
    const ephemeral = !preferPublic;

    try {
      await interaction.deferReply({ ephemeral });
    } catch (e: any) {
      const code = e?.code || e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (code === 40060 || code === 10062 || msg.includes('already been acknowledged') || msg.includes('unknown interaction')) return;
      throw e;
    }

    if (!openaiApiKey) {
      return interaction.editReply('OpenAI API key not configured. Set OPENAI_API_KEY in your environment to use /summarize.');
    }

    const count = interaction.options.getInteger('count') ?? 50;
    const lengthPref = interaction.options.getString('length') || 'short';

    const channel = interaction.channel as any;
    if (!channel || ![ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement].includes(channel.type)) {
      return interaction.editReply('This command can only run in a text channel or thread.');
    }

    const target = Math.min(1500, Math.max(1, count));
    let collected: any[] = [];
    let before: string | undefined;
    try {
      while (collected.length < target) {
        const limit = Math.min(100, target - collected.length);
        const batch = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
        if (!batch || batch.size === 0) break;
        const arr = [...batch.values()];
        collected.push(...arr);
        const oldest = arr.reduce((acc: any, m: any) => (!acc || m.createdTimestamp < acc.createdTimestamp) ? m : acc, null);
        before = oldest?.id;
      }
    } catch (err: any) {
      return interaction.editReply(`Could not fetch recent messages: ${err.message}`);
    }

    if (!collected.length) return interaction.editReply('No recent messages found to summarize.');

    const ordered = collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const sanitize = (s: string) => {
      if (!s) return '';
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
      const attachments = m.attachments?.size ? ` [attachments: ${[...m.attachments.values()].map((a: any) => a.name).filter(Boolean).join(', ')}]` : '';
      const line = content?.trim() ? `${author}: ${content}${attachments}` : (attachments ? `${author}:${attachments}` : '');
      if (line) transcript += `${line}\n`;
      if (transcript.length > maxInputChars * 1.5) break;
    }

    if (!transcript.trim()) return interaction.editReply('Recent messages have no textual content to summarize.');

    let truncated = transcript.trim();
    let truncatedNote = '';
    if (truncated.length > maxInputChars) {
      truncated = truncated.slice(0, maxInputChars);
      truncatedNote = `\n\n(Note: Input truncated to ${maxInputChars} characters for processing.)`;
    }

    try {
      const lengthInstruction = summaryLengthPrompts[lengthPref] || summaryLengthPrompts.medium;
      const systemPrompt = [
        'You are a concise summarization assistant.',
        'Attribute key points to speakers using the name before the colon in the transcript (e.g. "Alice:"). Include names in both the bullets and paragraph when referring to specific ideas, questions, or decisions; if attribution is unclear, omit names rather than guessing.',
        'Output must begin with "Bulleted Summary:" followed by bullet lines that start with "-" and no additional text on that heading line.',
        'After the bullet section, include a blank line and then "Paragraph Summary:" followed by a short paragraph.',
        'Do not invent headings beyond those two and focus only on the most important information.',
      ].join(' ');

      const userPrompt = [`Length preference: ${lengthPref}. ${lengthInstruction}`, 'Transcript:', truncated].join('\n\n');

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: openaiSummarizeModel,
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
        try {
          msg = JSON.parse(text)?.error?.message || msg;
        } catch (_) {}
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
      }).map((embed: any) => embed.toJSON());

      if (!embeds.length) return interaction.editReply('Summary was empty.');

      const [first, ...rest] = embeds;
      await interaction.editReply({ embeds: [first] });
      for (const embed of rest) {
        try {
          await interaction.followUp({ embeds: [embed], ephemeral });
        } catch (_) {}
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      try {
        await interaction.editReply(`Failed to summarize: ${msg}`);
      } catch (_) {
        try {
          await interaction.followUp({ content: `Failed to summarize: ${msg}`, ephemeral });
        } catch (_) {}
      }
    }
  },
};

export = command;
