import fs from 'node:fs';
import path from 'node:path';
import type { Client } from 'discord.js';

const logger = require('../utils/logger')('CommandHandler');

type RuntimeCommand = {
  data: { name: string };
  execute: (...args: any[]) => unknown;
};

type CandidateCommand = {
  data?: { name?: string };
  execute?: (...args: any[]) => unknown;
};

function resolveDefaultCommandsPath() {
  const distPath = path.join(__dirname, '..', 'commands');
  if (fs.existsSync(distPath)) return distPath;
  return path.join(process.cwd(), 'src', 'commands');
}

export function loadCommands(client: Client, commandsPath = resolveDefaultCommandsPath()) {
  if (!fs.existsSync(commandsPath)) {
    logger.warn('Commands directory not found, creating...');
    fs.mkdirSync(commandsPath, { recursive: true });
    client.commandLoadStats = { loaded: 0, total: 0 };
    return;
  }

  function getAllFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...getAllFiles(p));
      else if (e.isFile() && e.name.endsWith('.js')) files.push(p);
    }
    return files;
  }

  const commandFiles = getAllFiles(commandsPath);

  for (const filePath of commandFiles) {
    let command: CandidateCommand;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      command = require(filePath);
    } catch (err: any) {
      logger.warn(`Failed to load command at ${filePath}: ${err?.message || err}`);
      continue;
    }

    if (command?.data?.name && typeof command.execute === 'function') {
      const loaded: RuntimeCommand = {
        data: { name: command.data.name },
        execute: command.execute,
      };
      client.commands.set(loaded.data.name, loaded);
      logger.success(`Loaded command: ${loaded.data.name}`);
    } else {
      logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }

  client.commandLoadStats = {
    loaded: client.commands.size,
    total: commandFiles.length,
  };
  logger.info(`Loaded ${client.commands.size} commands.`);
}
