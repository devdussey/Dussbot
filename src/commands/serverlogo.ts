import path from 'node:path';
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('serverlogo')
    .setDescription("Display this server's icon")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const icon = guild.iconURL({ size: 4096 });
    if (!icon) {
      await interaction.reply({ content: 'This server does not have an icon set.', ephemeral: true });
      return;
    }

    const animated = Boolean(guild.icon && guild.icon.startsWith('a_'));
    const formats = animated ? ['gif', 'png', 'jpeg', 'webp'] : ['png', 'jpeg', 'webp'];
    const links = formats
      .map((fmt) => `[${fmt.toUpperCase()}](${guild.iconURL({ size: 4096, extension: fmt as 'gif' | 'png' | 'jpeg' | 'webp' })})`)
      .join(' • ');

    const embed = new EmbedBuilder()
      .setTitle(`${guild.name} server icon`)
      .setDescription(links)
      .setImage(icon)
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setTimestamp(Date.now());

    await interaction.reply({ embeds: [embed] });
  },
};

export = command;
