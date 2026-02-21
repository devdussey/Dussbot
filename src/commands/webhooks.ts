import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('webhooks')
    .setDescription('List all webhooks in this server and their creators'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
        return;
      }

      const webhooks = await guild.fetchWebhooks();
      if (!webhooks.size) {
        await interaction.reply('No webhooks found.');
        return;
      }

      const lines = webhooks.map((wh) => {
        const creator = wh.owner && 'tag' in wh.owner
          ? wh.owner.tag
          : (wh.owner?.username || 'Unknown');
        return `• ${wh.name} (ID: ${wh.id}) - created by ${creator}`;
      });
      const content = lines.join('\n');

      if (content.length <= 2000) {
        await interaction.reply(content);
      } else {
        await interaction.reply({ content: 'Too many webhooks to display.', ephemeral: true });
      }
    } catch (_) {
      await interaction.reply({ content: 'Failed to fetch webhooks.', ephemeral: true });
    }
  },
};

export = command;
