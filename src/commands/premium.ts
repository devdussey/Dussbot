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
const { getSupportServerUrl } = requireFromSrcIfNeeded('../utils/supportServer');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('View what is included with Premium'),

  async execute(interaction: ChatInputCommandInteraction) {
    const supportUrl = getSupportServerUrl();
    const embed = new EmbedBuilder()
      .setTitle('Premium')
      .setColor(resolveEmbedColour(interaction.guildId, 0x5865f2))
      .setDescription('Premium unlocks extra bot perks for your server and members.')
      .addFields(
        {
          name: 'Includes',
          value: [
            'Unlimited `/image removebg` usage in premium servers.',
            'Premium-only bot utilities and future premium feature drops.',
            'Premium access via active server boost or paid premium.',
          ].join('\n'),
          inline: false,
        },
        {
          name: 'Support Server',
          value: supportUrl,
          inline: false,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export = command;
