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

const { isCategoryEnabled, shouldReplyEphemeral, areRepliesPublic } = requireFromSrcIfNeeded('../utils/botConfigStore');

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API;
const openaiChatModel = process.env.CHAT_MODEL || 'gpt-4o-mini';

const personas: Record<string, string> = {
  neutral: 'You are a helpful, concise assistant. Be accurate and clear.',
  friendly: 'You are a warm, upbeat assistant. Keep a friendly tone while being concise and accurate.',
  professional: 'You are a precise, formal assistant. Focus on clarity, correctness, and brevity.',
  coach: 'You are a motivational coach. Encourage, ask clarifying questions, and suggest actionable next steps.',
  coder: 'You are a pragmatic software engineer. Provide working code, explain tradeoffs, and avoid overengineering.',
  moderator: 'You are a community moderator. Be calm, neutral, and policy-driven. Offer de-escalation tips.',
  creative: 'You are a creative writer. Offer imaginative, engaging prose while respecting instructions.',
};

const sanitize = (s: string) => {
  if (!s) return '';
  return String(s)
    .replace(/<@!?(\d+)>/g, '[@$1]')
    .replace(/<@&(\d+)>/g, '[@role:$1]')
    .replace(/<#(\d+)>/g, '[#channel:$1]');
};

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat with GPT with selectable persona')
    .addStringOption((opt) =>
      opt.setName('prompt')
        .setDescription('What you want to say/ask')
        .setRequired(true))
    .addStringOption((opt) =>
      opt.setName('persona')
        .setDescription('Choose a personality')
        .addChoices(
          { name: 'neutral', value: 'neutral' },
          { name: 'friendly', value: 'friendly' },
          { name: 'professional', value: 'professional' },
          { name: 'coach', value: 'coach' },
          { name: 'coder', value: 'coder' },
          { name: 'moderator', value: 'moderator' },
          { name: 'creative', value: 'creative' },
        )
        .setRequired(false))
    .addIntegerOption((opt) =>
      opt.setName('context')
        .setDescription('How many recent messages to include (0-50)')
        .setMinValue(0)
        .setMaxValue(50)
        .setRequired(false))
    .addNumberOption((opt) =>
      opt.setName('temperature')
        .setDescription('Creativity (0.0–2.0, default 0.7)')
        .setMinValue(0)
        .setMaxValue(2)
        .setRequired(false))
    .addBooleanOption((opt) =>
      opt.setName('private')
        .setDescription('Make the response visible only to you (ephemeral)')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isCategoryEnabled(interaction.guildId, 'ai', true)) {
      const ephemeral = shouldReplyEphemeral(interaction.guildId, 'ai', true);
      return interaction.reply({ content: 'AI commands are disabled by a server admin.', ephemeral });
    }

    const privateOpt = interaction.options.getBoolean('private');
    const preferPublic = areRepliesPublic(interaction.guildId, 'ai', false);
    const ephemeral = typeof privateOpt === 'boolean' ? privateOpt : !preferPublic;
    try {
      await interaction.deferReply({ ephemeral });
    } catch (_) {}

    if (!openaiApiKey) {
      return interaction.editReply('OpenAI API key not configured. Set OPENAI_API_KEY in your environment.');
    }

    const prompt = interaction.options.getString('prompt', true);
    const personaKey = interaction.options.getString('persona') || 'neutral';
    const persona = personas[personaKey] || personas.neutral;
    const contextCount = interaction.options.getInteger('context');
    const creativity = interaction.options.getNumber('temperature');

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: persona }];
    const channel = interaction.channel as any;
    if (channel && [ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement].includes(channel.type)) {
      const target = Math.min(50, Math.max(0, contextCount ?? 10));
      if (target > 0) {
        try {
          const batch = await channel.messages.fetch({ limit: target });
          const ordered = [...batch.values()].sort((a: any, b: any) => a.createdTimestamp - b.createdTimestamp);
          for (const m of ordered) {
            const role = m.author?.bot ? 'assistant' : 'user';
            const content = sanitize(m.content || '');
            if (content) messages.push({ role, content });
          }
        } catch (_) {}
      }
    }

    messages.push({ role: 'user', content: sanitize(prompt) });

    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: openaiChatModel,
          messages,
          temperature: typeof creativity === 'number' ? creativity : 0.7,
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
      const out = data?.choices?.[0]?.message?.content?.trim();
      if (!out) throw new Error('No response returned.');

      if (out.length <= 2000) return interaction.editReply(out);

      await interaction.editReply(out.slice(0, 2000));
      for (let i = 2000; i < out.length; i += 2000) {
        const chunk = out.slice(i, i + 2000);
        try {
          await interaction.followUp({ content: chunk, ephemeral });
        } catch (_) {}
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      try {
        await interaction.editReply(`Chat failed: ${msg}`);
      } catch (_) {
        try {
          await interaction.followUp({ content: `Chat failed: ${msg}`, ephemeral });
        } catch (_) {}
      }
    }
  },
};

export = command;
