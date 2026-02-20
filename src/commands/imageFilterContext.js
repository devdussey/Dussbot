const cmdLogger = require('../utils/logger')('imageFilterContext');
const {
  ApplicationCommandType,
  ApplicationIntegrationType,
  AttachmentBuilder,
  ContextMenuCommandBuilder,
  InteractionContextType,
} = require('discord.js');
const {
  applyImageFilter,
  deriveBaseName,
  downloadBuffer,
  resolveMessageImageSource,
} = require('../utils/imageFilterEngine');

const DEFAULT_EDIT = 'load';

async function safeRespond(interaction, message) {
  const payload = { content: message };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    await interaction.reply(payload);
  } catch (err) {
    cmdLogger.error('[Load context] Failed to send response:', err);
  }
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Load')
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
    try {
      const targetMessage = interaction.targetMessage;
      if (!targetMessage) {
        await safeRespond(interaction, 'Could not resolve that message.');
        return;
      }

      const source = resolveMessageImageSource(targetMessage);
      if (!source?.url) {
        await safeRespond(interaction, 'That message does not contain an image attachment or embed image.');
        return;
      }

      await interaction.deferReply();

      const sourceBuffer = await downloadBuffer(source.url);
      const result = await applyImageFilter(sourceBuffer, DEFAULT_EDIT);
      const baseName = deriveBaseName(source.name || source.url || 'image');
      const fileName = `${baseName}-${DEFAULT_EDIT}-filter.${result.outputExt}`;
      const output = new AttachmentBuilder(result.buffer, { name: fileName });

      await interaction.editReply({
        content: `Applied \`${DEFAULT_EDIT}\` filter at ${result.width}x${result.height} (fixed output size).`,
        files: [output],
      });
    } catch (err) {
      cmdLogger.error('[Load context] Command failed:', err);
      await safeRespond(interaction, `Could not apply that filter: ${err?.message || 'Unknown error'}`);
    }
  },
};

