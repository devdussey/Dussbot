const {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
} = require('discord.js');
const { translate } = require('@vitalets/google-translate-api');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function getLanguageLabel(code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = display.of(normalized);
    if (name) return `${name} (${normalized})`;
  } catch (_) {}
  return normalized;
}

function getMessageText(message) {
  const text = String(message?.content || '').trim();
  if (text) return text;
  return '';
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Translate to English')
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
    const targetMessage = interaction.targetMessage;
    const sourceText = getMessageText(targetMessage);

    if (!sourceText) {
      await interaction.reply({ content: 'That message has no text to translate.' });
      return;
    }

    await interaction.deferReply();

    try {
      const result = await translate(sourceText, { to: 'en' });
      const detectedCode = result?.raw?.src || 'unknown';
      const detectedLabel = getLanguageLabel(detectedCode);
      const englishText = String(result?.text || '').trim() || '(empty)';
      const author = targetMessage?.author;
      const avatarUrl = author?.displayAvatarURL?.({ size: 512, extension: 'png' }) || null;

      const embed = new EmbedBuilder()
        .setTitle('Translation')
        .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
        .setDescription(
          `Language: ${detectedLabel}\n${sourceText}\nEnglish: ${englishText}`.slice(0, 4096),
        )
        .setTimestamp(Date.now());

      if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const message = err?.message || 'Unknown error';
      await interaction.editReply({ content: `Failed to translate message: ${message}` });
    }
  },
};
