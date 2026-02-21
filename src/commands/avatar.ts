import path from 'node:path';
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type User } from 'discord.js';
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

const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');

function buildAvatarLinks(user: User) {
  const size = 4096;
  const animated = Boolean(user.avatar && user.avatar.startsWith('a_'));
  const formats = animated ? ['gif', 'png', 'jpeg', 'webp'] : ['png', 'jpeg', 'webp'];
  return formats
    .map((fmt) => {
      const url = user.displayAvatarURL({ size, extension: fmt as 'gif' | 'png' | 'jpeg' | 'webp', forceStatic: fmt === 'gif' ? false : true });
      return `[${fmt.toUpperCase()}](${url})`;
    })
    .join(' • ');
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Display a user's avatar")
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('User to lookup (defaults to you)')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const links = buildAvatarLinks(target);
    const displayUrl = target.displayAvatarURL({ size: 4096, extension: target.avatar?.startsWith('a_') ? 'gif' : 'png' });

    const embed = new EmbedBuilder()
      .setTitle(`${target.tag || target.username}'s avatar`)
      .setDescription(links)
      .setImage(displayUrl)
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setFooter({ text: `Requested by ${interaction.user.tag || interaction.user.username}` })
      .setTimestamp(Date.now());

    await interaction.reply({ embeds: [embed] });
  },
};

export = command;
