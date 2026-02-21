import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('botlook')
    .setDescription('Bot owner: change bot avatar, nickname, or bio')
    .addAttachmentOption((opt) =>
      opt
        .setName('avatar')
        .setDescription('New avatar image')
        .setRequired(false))
    .addStringOption((opt) =>
      opt
        .setName('nickname')
        .setDescription('New nickname for the bot in this server')
        .setRequired(false))
    .addStringOption((opt) =>
      opt
        .setName('bio')
        .setDescription('New bio for the bot user')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    return interaction.reply({
      content: 'Premium Servers Only, visit https://discord.gg/d83rZnXETm',
      ephemeral: true,
    });
  },
};

export = command;
