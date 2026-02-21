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

const cmdLogger = requireFromSrcIfNeeded('../utils/logger')('logconfig');
const { buildLogConfigView } = requireFromSrcIfNeeded('../utils/logConfigView');
const { isCategoryEnabled, shouldReplyEphemeral, areRepliesPublic } = requireFromSrcIfNeeded('../utils/botConfigStore');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('logconfig')
    .setDescription('Configure grouped logging routes and event channels')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to configure logging.', ephemeral: true });
    }

    if (!isCategoryEnabled(interaction.guildId, 'logging', true)) {
      const ephemeral = shouldReplyEphemeral(interaction.guildId, 'logging', true);
      return interaction.reply({ content: 'Logging commands are disabled by a server admin.', ephemeral });
    }

    const preferPublic = areRepliesPublic(interaction.guildId, 'logging', false);
    const ephemeral = !preferPublic;
    await interaction.deferReply({ ephemeral });

    try {
      const view = await buildLogConfigView(interaction.guild, null);
      await interaction.editReply({ embeds: [view.embed], components: view.components });
    } catch (err) {
      cmdLogger.error('Failed to build logging configuration view:', err);
      await interaction.editReply({ content: 'Failed to open the logging configuration. Please try again later.' });
    }
  },
};

export = command;
