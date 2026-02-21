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

type Issue = { severity: 'error' | 'warning'; message: string };

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
    .setDescription('Run admin diagnostics against command modules and client command state')
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
