const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger')('DeployCommands');
const { getCurrencyName, getCurrencyPlural } = require('../src/utils/currencyName');
require('dotenv').config();

const GUILD_INSTALL_INTEGRATION_TYPE = 0;
const COMMAND_DESCRIPTION_LIMIT = 100;

function toSentenceCaseLower(value) {
    return String(value || '').trim().toLowerCase();
}

function trimDescription(value) {
    const safe = String(value || '').trim();
    if (safe.length <= COMMAND_DESCRIPTION_LIMIT) return safe;
    return safe.slice(0, COMMAND_DESCRIPTION_LIMIT);
}

function applyGuildCurrencyOverrides(commandJson, guildId) {
    if (!commandJson || !guildId) return commandJson;

    const currencySingular = getCurrencyName(guildId);
    const currencyPlural = getCurrencyPlural(currencySingular);
    const pluralText = toSentenceCaseLower(currencyPlural);

    if (commandJson.name === 'balance') {
        commandJson.description = trimDescription(`View server ${pluralText} balances`);
        return commandJson;
    }

    if (commandJson.name === 'donate') {
        commandJson.description = trimDescription(`Admins: grant ${pluralText} to a user`);

        if (Array.isArray(commandJson.options)) {
            for (const option of commandJson.options) {
                if (option?.name === 'user') {
                    option.description = trimDescription(`Member to receive ${pluralText}`);
                } else if (option?.name === 'amount') {
                    option.description = trimDescription(`How many ${pluralText} to grant (default 1)`);
                }
            }
        }
    }

    return commandJson;
}

function buildGuildCommands(baseCommands, guildId) {
    return baseCommands.map((commandJson) => {
        const clone = JSON.parse(JSON.stringify(commandJson));
        return applyGuildCurrencyOverrides(clone, guildId);
    });
}

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

function getAllSourceCommandFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            files.push(...getAllSourceCommandFiles(p));
            continue;
        }
        if (!e.isFile()) continue;
        if (e.name.endsWith('.d.ts')) continue;
        if (e.name.endsWith('.ts') || e.name.endsWith('.js')) files.push(p);
    }
    return files;
}

function getModuleId(rootDir, filePath) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const ext = path.extname(rel);
    return rel.slice(0, -ext.length);
}

function validateDistCommands(distCommandsDir, srcCommandsDir) {
    if (!fs.existsSync(distCommandsDir)) {
        return { ok: false, missing: ['<dist/commands missing>'] };
    }

    const sourceFiles = fs.existsSync(srcCommandsDir) ? getAllSourceCommandFiles(srcCommandsDir) : [];
    if (sourceFiles.length === 0) return { ok: true, missing: [] };

    const sourceIds = new Set(sourceFiles.map((filePath) => getModuleId(srcCommandsDir, filePath)));
    const builtIds = new Set(getAllCommandFiles(distCommandsDir).map((filePath) => getModuleId(distCommandsDir, filePath)));
    const missing = Array.from(sourceIds).filter((id) => !builtIds.has(id));
    return { ok: missing.length === 0, missing };
}

function resolveCommandsDir() {
    if (process.env.COMMANDS_DIR) {
        return process.env.COMMANDS_DIR;
    }

    const distCommandsDir = path.join(__dirname, '..', 'dist', 'commands');
    const srcCommandsDir = path.join(__dirname, '..', 'src', 'commands');
    if (fs.existsSync(distCommandsDir)) {
        const validation = validateDistCommands(distCommandsDir, srcCommandsDir);
        if (!validation.ok) {
            const sample = validation.missing.slice(0, 5).join(', ');
            logger.error(
                `dist/commands is incomplete (${validation.missing.length} missing module(s): ` +
                `${sample}${validation.missing.length > 5 ? ', ...' : ''}).`,
            );
            logger.error('Refusing to deploy a partial command set. Run `npm run build:ts` first.');
            return null;
        }
        return distCommandsDir;
    }

    const srcJsFiles = fs.existsSync(srcCommandsDir) ? getAllCommandFiles(srcCommandsDir) : [];
    if (srcJsFiles.length > 0) {
        logger.warn('dist/commands not found; using src/commands JS modules.');
        return srcCommandsDir;
    }

    logger.error('No deployable command modules found (dist/commands missing and src/commands has no .js files).');
    logger.error('Run `npm run build:ts` before deploying commands.');
    return null;
}

const commandsDir = resolveCommandsDir();
if (!commandsDir) {
    process.exit(1);
}
const commands = [];
const files = getAllCommandFiles(commandsDir);
const nameToFile = new Map();
for (const filePath of files) {
    let command;
    try {
        command = require(filePath);
    } catch (error) {
        logger.error(`[ERROR] Failed to load command at ${filePath}: ${error.message}`);
        continue;
    }

    if (!('data' in command) || !('execute' in command)) {
        logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        continue;
    }

    const json = command.data.toJSON();
    if (!Array.isArray(json.integration_types) || !json.integration_types.length) {
        // Prevent Discord user-install command cap issues by defaulting unspecified commands to guild install only.
        json.integration_types = [GUILD_INSTALL_INTEGRATION_TYPE];
    }
    if (nameToFile.has(json.name)) {
        const firstPath = nameToFile.get(json.name);
        logger.warn(`[WARNING] Duplicate slash command name '${json.name}' in ${filePath}; skipping (already defined in ${firstPath}).`);
        continue;
    }
    nameToFile.set(json.name, filePath);
    commands.push(json);
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
        // If guild IDs are provided, always deploy guild commands so guild-specific text (currency names) can be applied.
        const shouldDeployGuild = guildIds.length > 0;
        const shouldDeployGlobal = deployBothScopes || !(env === 'development' && guildIds.length > 0);

        if (shouldDeployGuild) {
            logger.info(`Target scope: guild (${guildIds.join(', ')})`);
            if (!isDryRun) {
                for (const gid of guildIds) {
                    const guildCommands = buildGuildCommands(commands, gid);
                    const data = await rest.put(
                        Routes.applicationGuildCommands(clientId, gid),
                        { body: guildCommands },
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
