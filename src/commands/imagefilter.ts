import path from 'node:path';
import {
  ApplicationIntegrationType,
  AttachmentBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
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

const cmdLogger = requireFromSrcIfNeeded('../utils/logger')('imagefilter');
const {
  IMAGE_FILTER_EDIT_CHOICES,
  applyImageFilter,
  deriveBaseName,
  downloadBuffer,
  isHttpUrl,
} = requireFromSrcIfNeeded('../utils/imageFilterEngine');

async function safeRespond(interaction: ChatInputCommandInteraction, message: string) {
  const payload = { content: message };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    await interaction.reply(payload);
  } catch (err) {
    cmdLogger.error('[imagefilter] Failed to send response:', err);
  }
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('imagefilter')
    .setDescription('Apply a GIF overlay filter to an image')
    .setDMPermission(true)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addStringOption((option) => {
      option
        .setName('edits')
        .setDescription('Filter edit to apply')
        .setRequired(true);
      for (const choice of IMAGE_FILTER_EDIT_CHOICES) {
        option.addChoices(choice);
      }
      return option;
    })
    .addAttachmentOption((option) =>
      option
        .setName('image')
        .setDescription('Upload the image to filter')
        .setRequired(false))
    .addStringOption((option) =>
      option
        .setName('image_url')
        .setDescription('Direct image URL to filter')
        .setRequired(false))
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Use this user\'s avatar (when no image or image_url is provided)')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: false });

      const attachmentInput = interaction.options.getAttachment('image');
      const urlInput = interaction.options.getString('image_url');
      const userInput = interaction.options.getUser('user');
      const edit = interaction.options.getString('edits', true);
      const avatarUrl = userInput
        ? userInput.displayAvatarURL({
          size: 4096,
          extension: userInput.avatar?.startsWith('a_') ? 'gif' : 'png',
          forceStatic: false,
        })
        : null;
      const sourceUrl = attachmentInput?.url || urlInput || avatarUrl;

      if (!sourceUrl) {
        await safeRespond(interaction, 'Please upload an image, provide an image URL, or choose a user avatar.');
        return;
      }

      if (!attachmentInput && !isHttpUrl(sourceUrl)) {
        await safeRespond(interaction, 'Please provide a valid http/https URL.');
        return;
      }

      if (attachmentInput?.contentType && !attachmentInput.contentType.startsWith('image/')) {
        await safeRespond(interaction, 'The uploaded file must be an image.');
        return;
      }

      const sourceBuffer = await downloadBuffer(sourceUrl);
      const result = await applyImageFilter(sourceBuffer, edit);
      const baseName = attachmentInput?.name
        ? deriveBaseName(attachmentInput.name)
        : (userInput && sourceUrl === avatarUrl
          ? deriveBaseName(userInput.username || userInput.id)
          : deriveBaseName(sourceUrl));
      const fileName = `${baseName || 'image'}-${edit}-filter.${result.outputExt}`;
      const output = new AttachmentBuilder(result.buffer, { name: fileName });
      await interaction.editReply({
        content: `Take a \`${edit}\` off innit`,
        files: [output],
      });
    } catch (err: any) {
      cmdLogger.error('[imagefilter] Command failed:', err);
      await safeRespond(interaction, `Could not apply that filter: ${err?.message || 'Unknown error'}`);
    }
  },
};

export = command;
