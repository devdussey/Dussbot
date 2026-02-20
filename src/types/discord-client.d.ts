import 'discord.js';
import type { Collection } from 'discord.js';

type RuntimeCommand = {
  data: { name: string };
  execute: (...args: any[]) => unknown;
};

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, RuntimeCommand>;
    commandLoadStats?: {
      loaded: number;
      total: number;
    };
  }
}
