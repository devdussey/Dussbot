import path from 'node:path';
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

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

const { transcribeAttachment, MAX_BYTES } = requireFromSrcIfNeeded('../utils/whisper');
const { createFieldEmbeds } = requireFromSrcIfNeeded('../utils/embedFields');
const { isCategoryEnabled, shouldReplyEphemeral, areRepliesPublic } = requireFromSrcIfNeeded('../utils/botConfigStore');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('transcribe')
    .setDescription('Transcribe an audio file using OpenAI')
    .addAttachmentOption((opt) =>
      opt.setName('audio')
        .setDescription('Audio file to transcribe (mp3, wav, m4a, ogg, webm)')
        .setRequired(true))
    .addStringOption((opt) =>
      opt.setName('prompt')
        .setDescription('Optional context/prompt to guide transcription')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isCategoryEnabled(interaction.guildId, 'ai', true)) {
      const ephemeral = shouldReplyEphemeral(interaction.guildId, 'ai', true);
      return interaction.reply({ content: 'AI commands are disabled by a server admin.', ephemeral });
    }

    const preferPublic = areRepliesPublic(interaction.guildId, 'ai', false);
    const ephemeral = !preferPublic;
    await interaction.deferReply({ ephemeral });

    const attachment = interaction.options.getAttachment('audio');
    if (!attachment) {
      return interaction.editReply('Please attach an audio file.');
    }

    try {
      if (typeof attachment.size === 'number' && attachment.size > MAX_BYTES) {
        return interaction.editReply(`File is too large (${Math.round(attachment.size / (1024 * 1024))}MB). Max allowed is ${MAX_BYTES / (1024 * 1024)}MB.`);
      }
    } catch (_) {}

    const prompt = interaction.options.getString('prompt') || undefined;

    try {
      const text = await transcribeAttachment(attachment, prompt);
      const embeds = createFieldEmbeds({
        guildId: interaction.guildId,
        title: 'Transcript',
        user: interaction.user,
        sections: [{ name: 'Content', value: text }],
      }).map((embed: any) => embed.toJSON());

      if (!embeds.length) {
        return interaction.editReply('Transcript was empty.');
      }

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
        await interaction.editReply(`Failed to transcribe audio: ${msg}`);
      } catch (_) {
        try {
          await interaction.followUp({ content: `Failed to transcribe audio: ${msg}`, ephemeral });
        } catch (_) {}
      }
    }
  },
};

export = command;
