import path from 'node:path';
import { PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const cmdLogger = requireFromSrcIfNeeded('../utils/logger')('botconfig');
const { buildBotConfigView } = requireFromSrcIfNeeded('../utils/botConfigView');
const { shouldReplyEphemeral } = requireFromSrcIfNeeded('../utils/botConfigStore');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('botconfig')
    .setDescription('Configure bot categories (enable/disable) and reply visibility'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server permission is required to configure the bot.', ephemeral: true });
    }

    const ephemeral = shouldReplyEphemeral(interaction.guildId, 'utility', true);
    await interaction.deferReply({ ephemeral }).catch(() => {});

    try {
      const view = await buildBotConfigView(interaction.guild, null);
      await interaction.editReply({ embeds: [view.embed], components: view.components });
    } catch (err) {
      cmdLogger.error('Failed to build bot configuration view:', err);
      await interaction.editReply({ content: 'Failed to open the bot configuration. Please try again later.' });
    }
  },
};

export = command;
