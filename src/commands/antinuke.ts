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

const manager = requireFromSrcIfNeeded('../utils/antiNukeManager');

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Configure and monitor anti-nuke protections')
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Open the anti-nuke configuration panel')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub !== 'config') {
      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'You need Manage Server to update anti-nuke settings.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const view = await manager.buildConfigView(interaction.guild);
    return interaction.editReply({ embeds: [view.embed], components: view.components });
  },
};

export = command;
