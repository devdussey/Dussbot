const {
  ApplicationIntegrationType,
  AttachmentBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');
const {
  IMAGE_FILTER_EDIT_CHOICES,
  applyImageFilter,
  deriveBaseName,
  downloadBuffer,
  isHttpUrl,
} = require('../utils/imageFilterEngine');

async function safeRespond(interaction, message) {
  const payload = { content: message };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    await interaction.reply(payload);
  } catch (err) {
    console.error('[imagefilter] Failed to send response:', err);
  }
}

module.exports = {
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
    .addStringOption(option => {
      option
        .setName('edits')
        .setDescription('Filter edit to apply')
        .setRequired(true);
      for (const choice of IMAGE_FILTER_EDIT_CHOICES) {
        option.addChoices(choice);
      }
      return option;
    })
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Upload the image to filter')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('image_url')
        .setDescription('Direct image URL to filter')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const attachmentInput = interaction.options.getAttachment('image');
      const urlInput = interaction.options.getString('image_url');
      const edit = interaction.options.getString('edits', true);
      const sourceUrl = attachmentInput?.url || urlInput;

      if (!sourceUrl) {
        await safeRespond(interaction, 'Please upload an image or provide an image URL.');
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
        : deriveBaseName(sourceUrl);
      const fileName = `${baseName || 'image'}-${edit}-filter.${result.outputExt}`;
      const output = new AttachmentBuilder(result.buffer, { name: fileName });
      await interaction.editReply({
        content: `Applied \`${edit}\` filter at ${result.width}x${result.height} (fixed output size).`,
        files: [output],
      });
    } catch (err) {
      console.error('[imagefilter] Command failed:', err);
      await safeRespond(interaction, `Could not apply that filter: ${err?.message || 'Unknown error'}`);
    }
  },
};
