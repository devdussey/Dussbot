import type { ChatInputCommandInteraction, ClientEvents, SlashCommandBuilder } from 'discord.js';

type CommandData = SlashCommandBuilder | { name: string };

export interface SlashCommandModule {
  data: CommandData;
  execute: (interaction: ChatInputCommandInteraction) => Promise<unknown> | unknown;
}

export interface EventModule<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (...args: ClientEvents[K]) => Promise<unknown> | unknown;
}
