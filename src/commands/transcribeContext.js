const {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
} = require('discord.js');
const { transcribeAttachment, MAX_BYTES } = require('../utils/whisper');
const { createFieldEmbeds } = require('../utils/embedFields');
const {
  isCategoryEnabled,
} = require('../utils/botConfigStore');

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|webm|m4a|mp4|aac|flac)(\?|$)/i;

function looksLikeAudioAttachment(attachment) {
  if (!attachment?.url) return false;
  const ct = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  const url = String(attachment.url || '').toLowerCase();
  if (ct.startsWith('audio/')) return true;
  return AUDIO_EXT_RE.test(name) || AUDIO_EXT_RE.test(url);
}

function resolveAudioAttachment(message) {
  const attachments = Array.from(message?.attachments?.values?.() || []);
  for (const attachment of attachments) {
    if (looksLikeAudioAttachment(attachment)) return attachment;
  }
  return null;
}

module.exports = {
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

  async execute(interaction) {
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
      }).map(embed => embed.toJSON());

      if (!embeds.length) {
        await interaction.editReply('Transcript was empty.');
        return;
      }

      const [first, ...rest] = embeds;
      await interaction.editReply({ embeds: [first] });
      for (const embed of rest) {
        try { await interaction.followUp({ embeds: [embed] }); } catch (_) {}
      }
    } catch (err) {
      const msg = err?.message || String(err);
      await interaction.editReply(`Failed to transcribe audio: ${msg}`);
    }
  },
};
