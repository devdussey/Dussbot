const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger')('EventHandler');

function invokeHandler(eventName, file, execute, args) {
    try {
        const result = execute(...args);
        if (result && typeof result.then === 'function') {
            result.catch(error => {
                logger.error(`Unhandled async error in ${eventName} (${file}):`, error);
            });
        }
    } catch (error) {
        logger.error(`Unhandled error in ${eventName} (${file}):`, error);
    }
}

function loadEvents(client) {
    const eventsPath = path.join(__dirname, '..', 'events');

    if (!fs.existsSync(eventsPath)) {
        logger.warn('Events directory not found, creating...');
        fs.mkdirSync(eventsPath, { recursive: true });
        return;
    }

    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    const handlersByEvent = new Map();

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        let event;

        try {
            event = require(filePath);
        } catch (error) {
            logger.error(`Failed to load event ${file}:`, error);
            continue;
        }

        if (!event || !event.name || typeof event.execute !== 'function') {
            logger.warn(`Skipping invalid event module: ${file}`);
            continue;
        }

        const existing = handlersByEvent.get(event.name) || { onceHandlers: [], onHandlers: [] };
        const target = event.once ? existing.onceHandlers : existing.onHandlers;
        target.push({ file, execute: event.execute });
        handlersByEvent.set(event.name, existing);

        logger.success(`✓ Loaded event handler: ${event.name} (${file})${event.once ? ' [once]' : ''}`);
    }

    for (const [eventName, handlers] of handlersByEvent.entries()) {
        const { onceHandlers, onHandlers } = handlers;

        if (onHandlers.length === 0) {
            client.once(eventName, (...args) => {
                for (const handler of onceHandlers) {
                    invokeHandler(eventName, handler.file, handler.execute, args);
                }
            });
            logger.success(`✓ Registered dispatcher for ${eventName} (${onceHandlers.length} once handlers)`);
            continue;
        }

        let onceRan = false;
        client.on(eventName, (...args) => {
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
        logger.success(`✓ Registered dispatcher for ${eventName} (${onHandlers.length} persistent, ${onceHandlers.length} once)`);
    }
}

module.exports = { loadEvents };
