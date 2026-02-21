import path from 'node:path';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const logger = requireFromSrcIfNeeded('./utils/logger')('Bot');

require('dotenv').config();
requireFromSrcIfNeeded('./utils/embedColourEnforcer');

type RuntimeCommand = {
  data: { name: string };
  execute: (...args: any[]) => unknown;
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    // Needed for various logDispatcher events (invites, bans/mod actions, emojis, integrations, automod)
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember,
    Partials.User,
  ],
});

client.commands = new Collection<string, RuntimeCommand>();

loadCommands(client);
loadEvents(client);

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

client.once('clientReady', () => {
  logger.success(`Logged in as ${client.user?.tag || client.user?.id || 'discord bot'}`);
});

client.login(process.env.DISCORD_TOKEN).catch((error: unknown) => {
  logger.error('Failed to login:', error);
  process.exit(1);
});
