import path from 'node:path';
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
} from 'discord.js';

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
const { isCategoryEnabled } = requireFromSrcIfNeeded('../utils/botConfigStore');

const audioExtRe = /\.(mp3|wav|ogg|webm|m4a|mp4|aac|flac)(\?|$)/i;

function looksLikeAudioAttachment(attachment: any) {
  if (!attachment?.url) return false;
  const ct = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  const url = String(attachment.url || '').toLowerCase();
  if (ct.startsWith('audio/')) return true;
  return audioExtRe.test(name) || audioExtRe.test(url);
}

function resolveAudioAttachment(message: any) {
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const attachment of attachments as any[]) {
    if (looksLikeAudioAttachment(attachment)) return attachment;
  }
  return null;
}

const command = {
  data: new ContextMenuCommandBuilder()
    .setName('Transcribe')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(true)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction: any) {
    if (!isCategoryEnabled(interaction.guildId, 'ai', true)) {
      await interaction.reply({ content: 'AI commands are disabled by a server admin.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const attachment = resolveAudioAttachment(interaction.targetMessage);
    if (!attachment) {
      await interaction.editReply('That message does not contain an audio attachment.');
      return;
    }

    if (typeof attachment.size === 'number' && attachment.size > MAX_BYTES) {
      await interaction.editReply(
        `File is too large (${Math.round(attachment.size / (1024 * 1024))}MB). Max allowed is ${MAX_BYTES / (1024 * 1024)}MB.`,
      );
      return;
    }

    try {
      const text = await transcribeAttachment(attachment);
      const embeds = createFieldEmbeds({
        guildId: interaction.guildId,
        title: 'Transcript',
        user: interaction.user,
        sections: [{ name: 'Content', value: text }],
      }).map((embed: any) => embed.toJSON());

      if (!embeds.length) {
        await interaction.editReply('Transcript was empty.');
        return;
      }

      const [first, ...rest] = embeds;
      await interaction.editReply({ embeds: [first] });
      for (const embed of rest) {
        try {
          await interaction.followUp({ embeds: [embed] });
        } catch (_) {}
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      await interaction.editReply(`Failed to transcribe audio: ${msg}`);
    }
  },
};

export = command;
