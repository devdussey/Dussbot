const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger')('CommandHandler');

function loadCommands(client, commandsPath = path.join(__dirname, '..', 'commands')) {
    if (!fs.existsSync(commandsPath)) {
        logger.warn('Commands directory not found, creating...');
        fs.mkdirSync(commandsPath, { recursive: true });
        client.commandLoadStats = { loaded: 0, total: 0 };
        return;
    }

    function getAllFiles(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files = [];
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) files.push(...getAllFiles(p));
            else if (e.isFile() && e.name.endsWith('.js')) files.push(p);
        }
        return files;
    }

    const commandFiles = getAllFiles(commandsPath);

    for (const filePath of commandFiles) {
        let command;
        try {
            command = require(filePath);
        } catch (err) {
            logger.warn(`⚠ Failed to load command at ${filePath}: ${err.message}`);
            continue;
        }

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            logger.success(`✓ Loaded command: ${command.data.name}`);
        } else {
            logger.warn(`⚠ The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }

    client.commandLoadStats = {
        loaded: client.commands.size,
        total: commandFiles.length,
    };
    logger.info(`Loaded ${client.commands.size} commands.`);
}

module.exports = { loadCommands };
