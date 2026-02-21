import path from 'node:path';
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
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

const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');

function pushMedia(entries: Array<{ url: string; label: string; kind: string }>, url: string | undefined, label: string, kind: string) {
  if (!url) return;
  if (entries.some((entry) => entry.url === url)) return;
  entries.push({ url, label, kind });
}

function collectMessageMedia(message: any) {
  const entries: Array<{ url: string; label: string; kind: string }> = [];
  const attachments = Array.from(message?.attachments?.values?.() || []);
  let attachmentIndex = 0;
  for (const attachment of attachments as any[]) {
    attachmentIndex += 1;
    const label = attachment.name || `Attachment ${attachmentIndex}`;
    pushMedia(entries, attachment.url, label, 'Attachment');
    if (attachment.proxyURL && attachment.proxyURL !== attachment.url) {
      pushMedia(entries, attachment.proxyURL, `${label} (proxy)`, 'Attachment');
    }
  }

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  let embedIndex = 0;
  for (const embed of embeds) {
    embedIndex += 1;
    pushMedia(entries, embed?.image?.url, `Embed image ${embedIndex}`, 'Embed');
    pushMedia(entries, embed?.thumbnail?.url, `Embed thumbnail ${embedIndex}`, 'Embed');
    pushMedia(entries, embed?.video?.url, `Embed video ${embedIndex}`, 'Embed');
  }

  return entries;
}

const command = {
  data: new ContextMenuCommandBuilder()
    .setName('Save Media')
    .setType(ApplicationCommandType.Message),

  async execute(interaction: any) {
    const message = interaction.targetMessage;
    if (!message) {
      await interaction.reply({ content: 'Could not resolve that message.', ephemeral: true });
      return;
    }

    const media = collectMessageMedia(message);
    if (!media.length) {
      await interaction.reply({
        content: 'No downloadable media was found on that message.',
        ephemeral: true,
      });
      return;
    }

    const shown = media.slice(0, 20);
    const lines = shown.map((item, idx) => `${idx + 1}. [${item.label}](${item.url})`);

    const embed = new EmbedBuilder()
      .setTitle('Save Media')
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setDescription(lines.join('\n').slice(0, 4096))
      .addFields(
        { name: 'Source Message', value: message.url || 'Unknown', inline: false },
      )
      .setFooter({
        text: media.length > shown.length
          ? `Showing ${shown.length} of ${media.length} media items`
          : `${media.length} media item${media.length === 1 ? '' : 's'} found`,
      })
      .setTimestamp(Date.now());

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export = command;
