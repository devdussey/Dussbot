import path from 'node:path';
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
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

const { translate } = require('@vitalets/google-translate-api');
const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');

function getLanguageLabel(code: string) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = display.of(normalized);
    if (name) return `${name} (${normalized})`;
  } catch (_) {}
  return normalized;
}

function getMessageText(message: any) {
  const text = String(message?.content || '').trim();
  if (text) return text;
  return '';
}

const command = {
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

  async execute(interaction: any) {
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
        .setDescription(`Language: ${detectedLabel}\n${sourceText}\nEnglish: ${englishText}`.slice(0, 4096))
        .setTimestamp(Date.now());

      if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      const message = err?.message || 'Unknown error';
      await interaction.editReply({ content: `Failed to translate message: ${message}` });
    }
  },
};

export = command;
