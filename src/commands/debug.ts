import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

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

const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');
const { loadCommands } = requireFromSrcIfNeeded('../handlers/commandHandler');
const { loadEvents } = requireFromSrcIfNeeded('../handlers/eventHandler');

type Issue = { severity: 'error' | 'warning'; message: string };
type RuntimeRootType = 'commands' | 'events';
type RefreshReport = {
  commandFiles: number;
  eventFiles: number;
  clearedCacheEntries: number;
  reloadedEventNames: number;
  loadedCommandCount: number;
};

function collectJavaScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(target));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
  return files;
}

function collectJavaScriptFilesFromRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  for (const root of roots) {
    for (const file of collectJavaScriptFiles(root)) {
      const normalized = path.normalize(file);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      files.push(normalized);
    }
  }

  return files;
}

function resolveRuntimeRoots(type: RuntimeRootType): string[] {
  const distPath = path.join(process.cwd(), 'dist', type);
  const srcPath = path.join(process.cwd(), 'src', type);
  const allowSrcFallback = process.env.ALLOW_SRC_FALLBACK === '1';

  if (fs.existsSync(distPath)) {
    if (allowSrcFallback && fs.existsSync(srcPath) && srcPath !== distPath) {
      return [distPath, srcPath];
    }
    return [distPath];
  }

  if (fs.existsSync(srcPath)) {
    return [srcPath];
  }

  return [];
}

function collectEventNames(eventFiles: string[]): string[] {
  const names = new Set<string>();

  for (const file of eventFiles) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const eventModule = require(file);
      const eventName = typeof eventModule?.name === 'string' ? eventModule.name.trim() : '';
      if (eventName) names.add(eventName);
    } catch (_) {
      // Skip invalid event files during refresh discovery.
    }
  }

  return Array.from(names);
}

function clearRequireCache(files: string[]): number {
  let cleared = 0;

  for (const file of files) {
    let resolved = file;
    try {
      resolved = require.resolve(file);
    } catch (_) {
      resolved = file;
    }

    if (require.cache[resolved]) {
      delete require.cache[resolved];
      cleared += 1;
    }
  }

  return cleared;
}

function runRuntimeRefresh(client: Client): RefreshReport {
  const commandRoots = resolveRuntimeRoots('commands');
  const eventRoots = resolveRuntimeRoots('events');
  const commandFiles = collectJavaScriptFilesFromRoots(commandRoots);
  const eventFiles = collectJavaScriptFilesFromRoots(eventRoots);
  const eventNames = collectEventNames(eventFiles);

  for (const eventName of eventNames) {
    client.removeAllListeners(eventName as any);
  }

  const clearedCacheEntries = clearRequireCache([...commandFiles, ...eventFiles]);

  if (typeof (client as any).commands?.clear === 'function') {
    (client as any).commands.clear();
  }

  loadCommands(client);
  loadEvents(client);

  return {
    commandFiles: commandFiles.length,
    eventFiles: eventFiles.length,
    clearedCacheEntries,
    reloadedEventNames: eventNames.length,
    loadedCommandCount: (client as any).commands?.size || 0,
  };
}

function runCommandDiagnostics(client: Client) {
  const commandsDir = path.join(__dirname);
  const files = collectJavaScriptFiles(commandsDir);
  const discoveredCommands = new Map<string, string>();
  const issues: Issue[] = [];

  for (const file of files) {
    const rel = path.relative(commandsDir, file).replace(/\\/g, '/');
    let commandModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      commandModule = require(file);
    } catch (err: any) {
      issues.push({ severity: 'error', message: `${rel}: failed to load (${err?.message || 'unknown error'})` });
      continue;
    }

    if (!commandModule || typeof commandModule !== 'object') {
      issues.push({ severity: 'error', message: `${rel}: module export is invalid` });
      continue;
    }
    if (!commandModule.data) {
      issues.push({ severity: 'error', message: `${rel}: missing 'data' export` });
      continue;
    }
    if (typeof commandModule.execute !== 'function') {
      issues.push({ severity: 'error', message: `${rel}: missing 'execute' function` });
      continue;
    }

    let json: any;
    try {
      json = commandModule.data.toJSON();
    } catch (err: any) {
      issues.push({ severity: 'error', message: `${rel}: slash command data could not be serialized (${err?.message || 'unknown error'})` });
      continue;
    }

    const slashName = typeof json?.name === 'string' ? json.name.trim() : '';
    if (!slashName) {
      issues.push({ severity: 'error', message: `${rel}: slash command is missing a valid name` });
      continue;
    }

    if (discoveredCommands.has(slashName)) {
      const firstPath = discoveredCommands.get(slashName);
      issues.push({ severity: 'error', message: `Duplicate command '/${slashName}' in ${firstPath} and ${rel}` });
      continue;
    }

    discoveredCommands.set(slashName, rel);
  }

  for (const [name] of discoveredCommands) {
    if (!(client as any).commands?.has(name)) {
      issues.push({ severity: 'warning', message: `Discovered '/${name}' on disk but not loaded in client.commands` });
    }
  }

  for (const [name] of ((client as any).commands || [])) {
    if (!discoveredCommands.has(name)) {
      issues.push({ severity: 'warning', message: `Loaded '/${name}' in client.commands but no matching file was discovered` });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity !== 'error').length;

  return {
    scannedFiles: files.length,
    discoveredCommandCount: discoveredCommands.size,
    loadedCommandCount: (client as any).commands?.size || 0,
    issues,
    errorCount,
    warningCount,
  };
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Run admin diagnostics or refresh command/event handlers')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Select debug mode')
        .addChoices(
          { name: 'diagnostics', value: 'diagnostics' },
          { name: 'refresh', value: 'refresh' },
        ),
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return interaction.reply({ content: 'Administrator permission is required to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const mode = interaction.options.getString('mode') || 'diagnostics';
    if (mode === 'refresh') {
      try {
        const report = runRuntimeRefresh(interaction.client);
        const embed = new EmbedBuilder()
          .setTitle('Debug Refresh Complete')
          .setColor(resolveEmbedColour(interaction.guildId, 0x57f287))
          .setDescription(
            [
              `Mode: **refresh**`,
              `Command files scanned: **${report.commandFiles}**`,
              `Event files scanned: **${report.eventFiles}**`,
              `Event names reloaded: **${report.reloadedEventNames}**`,
              `Require cache entries cleared: **${report.clearedCacheEntries}**`,
              `Commands currently loaded: **${report.loadedCommandCount}**`,
            ].join('\n'),
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        const message = err?.message ? String(err.message) : 'unknown error';
        await interaction.editReply({ content: `Refresh failed: ${message}` });
      }
      return;
    }

    const report = runCommandDiagnostics(interaction.client);
    const color = report.errorCount > 0
      ? 0xed4245
      : report.warningCount > 0
        ? 0xfee75c
        : resolveEmbedColour(interaction.guildId, 0x57f287);

    const embed = new EmbedBuilder()
      .setTitle('Debug Report')
      .setColor(color)
      .setDescription(
        [
          `Scanned files: **${report.scannedFiles}**`,
          `Commands discovered on disk: **${report.discoveredCommandCount}**`,
          `Commands loaded in client: **${report.loadedCommandCount}**`,
          `Errors: **${report.errorCount}**`,
          `Warnings: **${report.warningCount}**`,
        ].join('\n'),
      )
      .setTimestamp();

    if (!report.issues.length) {
      embed.addFields({
        name: 'Findings',
        value: 'No command-level issues detected in this local client scan.',
      });
    } else {
      const lines = report.issues
        .slice(0, 12)
        .map((issue, idx) => `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
      if (report.issues.length > 12) {
        lines.push(`...and ${report.issues.length - 12} more issue(s).`);
      }
      embed.addFields({
        name: 'Findings',
        value: lines.join('\n').slice(0, 1024),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export = command;
