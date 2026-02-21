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

const logger = requireFromSrcIfNeeded('../utils/logger')('EventHandler');

type RuntimeEvent = {
  name?: string;
  once?: boolean;
  execute?: (...args: any[]) => unknown;
};

function invokeHandler(eventName: string, file: string, execute: (...args: any[]) => unknown, args: any[]) {
  try {
    const result = execute(...args);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).catch((error) => {
        logger.error(`Unhandled async error in ${eventName} (${file}):`, error);
      });
    }
  } catch (error) {
    logger.error(`Unhandled error in ${eventName} (${file}):`, error);
  }
}

function resolveDefaultEventRoots() {
  const distPath = path.join(__dirname, '..', 'events');
  const srcPath = path.join(process.cwd(), 'src', 'events');
  const roots: string[] = [];
  const allowSrcFallback = process.env.ALLOW_SRC_FALLBACK === '1';

  if (fs.existsSync(distPath)) {
    roots.push(distPath);
    if (allowSrcFallback && fs.existsSync(srcPath) && srcPath !== distPath) {
      roots.push(srcPath);
    }
    return roots;
  }

  if (fs.existsSync(srcPath)) {
    logger.warn('dist events directory not found; falling back to src events.');
    roots.push(srcPath);
  }

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

function collectEventFiles(roots: string[]) {
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

export function loadEvents(client: Client, eventsPath?: string | string[]) {
  const roots = Array.isArray(eventsPath)
    ? eventsPath.filter((p) => fs.existsSync(p))
    : eventsPath
      ? (fs.existsSync(eventsPath) ? [eventsPath] : [])
      : resolveDefaultEventRoots();

  if (roots.length === 0) {
    logger.warn('No events directories found to load.');
    return;
  }

  const eventFiles = collectEventFiles(roots);
  const handlersByEvent = new Map<string, { onceHandlers: Array<{ file: string; execute: (...args: any[]) => unknown }>; onHandlers: Array<{ file: string; execute: (...args: any[]) => unknown }> }>();

  for (const filePath of eventFiles) {
    const file = path.basename(filePath);
    let event: RuntimeEvent;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      event = require(filePath);
    } catch (error) {
      logger.error(`Failed to load event ${file}:`, error);
      continue;
    }

    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn(`Skipping invalid event module: ${file}`);
      continue;
    }

    const existing = handlersByEvent.get(event.name) || { onceHandlers: [], onHandlers: [] };
    const target = event.once ? existing.onceHandlers : existing.onHandlers;
    target.push({ file, execute: event.execute });
    handlersByEvent.set(event.name, existing);

    logger.success(`Loaded event handler: ${event.name} (${file})${event.once ? ' [once]' : ''}`);
  }

  for (const [eventName, handlers] of handlersByEvent.entries()) {
    const { onceHandlers, onHandlers } = handlers;

    if (onHandlers.length === 0) {
      client.once(eventName as any, (...args: any[]) => {
        for (const handler of onceHandlers) {
          invokeHandler(eventName, handler.file, handler.execute, args);
        }
      });
      logger.success(`Registered dispatcher for ${eventName} (${onceHandlers.length} once handlers)`);
      continue;
    }

    let onceRan = false;
    client.on(eventName as any, (...args: any[]) => {
      if (!onceRan) {
        onceRan = true;
        for (const handler of onceHandlers) {
          invokeHandler(eventName, handler.file, handler.execute, args);
        }
      }

      for (const handler of onHandlers) {
        invokeHandler(eventName, handler.file, handler.execute, args);
      }
    });
    logger.success(`Registered dispatcher for ${eventName} (${onHandlers.length} persistent, ${onceHandlers.length} once)`);
  }
}
