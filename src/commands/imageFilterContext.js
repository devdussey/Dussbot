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
    const targetMessage = interaction.targetMessage;
    if (!targetMessage) {
      await interaction.reply({ content: 'Could not resolve that message.' });
      return;
    }

    const source = resolveMessageImageSource(targetMessage);
    if (!source?.url) {
      await interaction.reply({
        content: 'That message does not contain an image attachment or embed image.',
      });
      return;
    }

    await interaction.deferReply();

    try {
      const sourceBuffer = await downloadBuffer(source.url);
      const result = await applyImageFilter(sourceBuffer, DEFAULT_EDIT);
      const baseName = deriveBaseName(source.name || source.url || 'image');
      const fileName = `${baseName}-${DEFAULT_EDIT}-filter.${result.outputExt}`;
      const output = new AttachmentBuilder(result.buffer, { name: fileName });

      await interaction.editReply({
        content: `Applied \`${DEFAULT_EDIT}\` filter at ${result.width}x${result.height}.`,
        files: [output],
      });
    } catch (err) {
      await interaction.editReply(`Could not apply that filter: ${err.message}`);
    }
  },
};
