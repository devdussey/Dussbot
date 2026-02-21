import path from 'node:path';
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  AttachmentBuilder,
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

const cmdLogger = requireFromSrcIfNeeded('../utils/logger')('imageFilterContext');
const {
  applyImageFilter,
  deriveBaseName,
  downloadBuffer,
  resolveMessageImageSource,
} = requireFromSrcIfNeeded('../utils/imageFilterEngine');

const defaultEdit = 'load';

async function safeRespond(interaction: any, message: string) {
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

const command = {
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

  async execute(interaction: any) {
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
      const result = await applyImageFilter(sourceBuffer, defaultEdit);
      const baseName = deriveBaseName(source.name || source.url || 'image');
      const fileName = `${baseName}-${defaultEdit}-filter.${result.outputExt}`;
      const output = new AttachmentBuilder(result.buffer, { name: fileName });

      await interaction.editReply({
        content: `Applied \`${defaultEdit}\` filter at ${result.width}x${result.height} (fixed output size).`,
        files: [output],
      });
    } catch (err: any) {
      cmdLogger.error('[Load context] Command failed:', err);
      await safeRespond(interaction, `Could not apply that filter: ${err?.message || 'Unknown error'}`);
    }
  },
};

export = command;
