const {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function pushMedia(entries, url, label, kind) {
  if (!url) return;
  if (entries.some(entry => entry.url === url)) return;
  entries.push({ url, label, kind });
}

function collectMessageMedia(message) {
  const entries = [];
  const attachments = Array.from(message?.attachments?.values?.() || []);
  let attachmentIndex = 0;
  for (const attachment of attachments) {
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

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Save Media')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
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
