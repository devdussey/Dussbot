import path from 'node:path';
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const { shouldReplyEphemeral } = requireFromSrcIfNeeded('../utils/botConfigStore');
const { buildBotSettingsView } = requireFromSrcIfNeeded('../utils/botSettingsView');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('botsettings')
    .setDescription('View the bot settings and defaults for this server'),

  async execute(interaction: ChatInputCommandInteraction) {
    const view = buildBotSettingsView(interaction.guild);
    const ephemeral = shouldReplyEphemeral(interaction.guildId, 'utility', true);
    return interaction.reply({ embeds: [view.embed], components: view.components, ephemeral });
  },
};

export = command;
