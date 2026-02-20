import fs from 'node:fs';
import path from 'node:path';
import type { Client } from 'discord.js';

const logger = require('../utils/logger')('EventHandler');

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

function resolveDefaultEventsPath() {
  const distPath = path.join(__dirname, '..', 'events');
  if (fs.existsSync(distPath)) return distPath;
  return path.join(process.cwd(), 'src', 'events');
}

export function loadEvents(client: Client, eventsPath = resolveDefaultEventsPath()) {
  if (!fs.existsSync(eventsPath)) {
    logger.warn('Events directory not found, creating...');
    fs.mkdirSync(eventsPath, { recursive: true });
    return;
  }

  const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
  const handlersByEvent = new Map<string, { onceHandlers: Array<{ file: string; execute: (...args: any[]) => unknown }>; onHandlers: Array<{ file: string; execute: (...args: any[]) => unknown }> }>();

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
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
