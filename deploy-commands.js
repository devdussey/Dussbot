const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger')('DeployCommands');
require('dotenv').config();

function getAllCommandFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...getAllCommandFiles(p));
        else if (e.isFile() && e.name.endsWith('.js')) files.push(p);
    }
    return files;
}

const commandsDir = process.env.COMMANDS_DIR || path.join(__dirname, 'src', 'commands');
const commands = [];
const files = getAllCommandFiles(commandsDir);
const nameToFile = new Map();
for (const filePath of files) {
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        const json = command.data.toJSON();
        if (nameToFile.has(json.name)) {
            const firstPath = nameToFile.get(json.name);
            logger.warn(`[WARNING] Duplicate slash command name '${json.name}' in ${filePath}; skipping (already defined in ${firstPath}).`);
            continue;
        }
        nameToFile.set(json.name, filePath);
        commands.push(json);
    } else {
        logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}
logger.info('Commands to deploy: ' + (Array.from(nameToFile.keys()).join(', ') || '(none)'));

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || process.env.DRY_RUN === '1';
const deployBothScopes = args.includes('--both-scopes') || process.env.DEPLOY_BOTH_SCOPES === '1';

const token = process.env.DISCORD_TOKEN;
const rest = new REST().setToken(token);

(async () => {
    try {
        logger.info(`Preparing to refresh ${commands.length} application (/) commands${isDryRun ? ' [DRY-RUN]' : ''}.`);

        const env = (process.env.NODE_ENV || '').trim().toLowerCase();
        const clientId = process.env.CLIENT_ID;
        const guildIds = (process.env.GUILD_IDS || process.env.GUILD_ID || '')
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(Boolean);

        if (!token) {
            throw new Error('Missing DISCORD_TOKEN in environment.');
        }

        if (!clientId) {
            throw new Error('Missing CLIENT_ID in environment.');
        }

        // Guild-scoped commands appear instantly, whereas global updates may take up to an hour to propagate.
        const shouldDeployGuild = guildIds.length > 0 && (env === 'development' || deployBothScopes);
        const shouldDeployGlobal = deployBothScopes || !(env === 'development' && guildIds.length > 0);

        if (shouldDeployGuild) {
            logger.info(`Target scope: guild (${guildIds.join(', ')})`);
            if (!isDryRun) {
                for (const gid of guildIds) {
                    const data = await rest.put(
                        Routes.applicationGuildCommands(clientId, gid),
                        { body: commands },
                    );
                    logger.success(`Successfully reloaded ${data.length} guild application (/) commands for guild ${gid}.`);
                }
            } else {
                logger.info('DRY-RUN: Skipping REST deployment for guild scope.');
            }
        }

        if (shouldDeployGlobal) {
            logger.info('Target scope: global');
            if (!isDryRun) {
                const data = await rest.put(
                    Routes.applicationCommands(clientId),
                    { body: commands },
                );
                logger.success(`Successfully reloaded ${data.length} global application (/) commands.`);
            } else {
                logger.info('DRY-RUN: Skipping REST deployment for global scope.');
            }
        }
    } catch (error) {
        logger.error('Error deploying commands:', error);
        process.exitCode = 1;
    }
})();
