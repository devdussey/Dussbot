const {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
} = require('discord.js');
const { resolveEmbedColour } = require('../utils/guildColourStore');

function buildAvatarLinks(user) {
  const size = 4096;
  const animated = Boolean(user.avatar && user.avatar.startsWith('a_'));
  const formats = animated ? ['gif', 'png', 'jpeg', 'webp'] : ['png', 'jpeg', 'webp'];
  return formats
    .map((fmt) => {
      const url = user.displayAvatarURL({ size, extension: fmt, forceStatic: fmt !== 'gif' });
      return `[${fmt.toUpperCase()}](${url})`;
    })
    .join(' • ');
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Avatar')
    .setType(ApplicationCommandType.User)
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
    const target = interaction.targetUser || interaction.user;
    const links = buildAvatarLinks(target);
    const displayUrl = target.displayAvatarURL({
      size: 4096,
      extension: target.avatar?.startsWith('a_') ? 'gif' : 'png',
    });

    const embed = new EmbedBuilder()
      .setTitle(`${target.tag || target.username}'s avatar`)
      .setDescription(links)
      .setImage(displayUrl)
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setFooter({ text: `Requested by ${interaction.user.tag || interaction.user.username}` })
      .setTimestamp(Date.now());

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
