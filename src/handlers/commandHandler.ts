import fs from 'node:fs';
import path from 'node:path';
import type { Client } from 'discord.js';

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

const logger = requireFromSrcIfNeeded('../utils/logger')('CommandHandler');

type RuntimeCommand = {
  data: { name: string };
  execute: (...args: any[]) => unknown;
};

type CandidateCommand = {
  data?: { name?: string };
  execute?: (...args: any[]) => unknown;
};

function resolveDefaultCommandRoots() {
  const distPath = path.join(__dirname, '..', 'commands');
  const srcPath = path.join(process.cwd(), 'src', 'commands');
  const roots: string[] = [];
  if (fs.existsSync(distPath)) roots.push(distPath);
  if (fs.existsSync(srcPath) && srcPath !== distPath) roots.push(srcPath);
  return roots;
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

function collectCommandFiles(roots: string[]) {
  const seenRelative = new Set<string>();
  const files: string[] = [];

  for (const root of roots) {
    for (const filePath of getAllFiles(root)) {
      const relative = path.relative(root, filePath).replace(/\\/g, '/');
      if (seenRelative.has(relative)) continue;
      seenRelative.add(relative);
      files.push(filePath);
    }
  }

  return files;
}

export function loadCommands(client: Client, commandsPath?: string | string[]) {
  const roots = Array.isArray(commandsPath)
    ? commandsPath.filter((p) => fs.existsSync(p))
    : commandsPath
      ? (fs.existsSync(commandsPath) ? [commandsPath] : [])
      : resolveDefaultCommandRoots();

  if (roots.length === 0) {
    logger.warn('No commands directories found to load.');
    client.commandLoadStats = { loaded: 0, total: 0 };
    return;
  }

  const commandFiles = collectCommandFiles(roots);

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
      if (client.commands.has(loaded.data.name)) {
        logger.warn(`Duplicate command name "${loaded.data.name}" from ${filePath}; keeping the first loaded handler.`);
        continue;
      }
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
