const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DIST_ENTRY = path.join(__dirname, 'dist', 'index.js');
const SRC_DIR = path.join(__dirname, 'src');
const LOCAL_TSC = path.join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc');
const LOCAL_NODE_TYPES = path.join(__dirname, 'node_modules', '@types', 'node', 'package.json');
const DIST_DIR = path.join(__dirname, 'dist');

function getNpmBinary() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runProcess(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function runProcessCapture(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function getNewestSourceMtimeMs(dir) {
  if (!fs.existsSync(dir)) return 0;
  let newest = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, getNewestSourceMtimeMs(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      !entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.js')
    ) {
      continue;
    }
    const stat = fs.statSync(full);
    newest = Math.max(newest, stat.mtimeMs);
  }
  return newest;
}

function getModuleIds(rootDir, allowedExtensions) {
  if (!fs.existsSync(rootDir)) return [];
  const ids = new Set();

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = path.relative(rootDir, full).replace(/\\/g, '/');
      if (relative.endsWith('.d.ts')) continue;
      const ext = path.extname(relative).toLowerCase();
      if (!allowedExtensions.has(ext)) continue;
      ids.add(relative.slice(0, -ext.length));
    }
  }

  walk(rootDir);
  return Array.from(ids);
}

function getMissingDistModules(sourceDir, distDir) {
  const sourceModules = getModuleIds(sourceDir, new Set(['.ts', '.js']));
  if (sourceModules.length === 0) return [];
  const builtModules = new Set(getModuleIds(distDir, new Set(['.js'])));
  return sourceModules.filter((moduleId) => !builtModules.has(moduleId));
}

function getDistHealth() {
  const issues = [];

  if (!fs.existsSync(DIST_ENTRY)) {
    issues.push('dist/index.js is missing');
    return { ok: false, issues, missingCommands: [], missingEvents: [] };
  }

  const missingCommands = getMissingDistModules(
    path.join(SRC_DIR, 'commands'),
    path.join(DIST_DIR, 'commands'),
  );
  if (missingCommands.length > 0) {
    const sample = missingCommands.slice(0, 5).join(', ');
    issues.push(
      `dist/commands missing ${missingCommands.length} module(s)` +
      (sample ? ` (${sample}${missingCommands.length > 5 ? ', ...' : ''})` : ''),
    );
  }

  const missingEvents = getMissingDistModules(
    path.join(SRC_DIR, 'events'),
    path.join(DIST_DIR, 'events'),
  );
  if (missingEvents.length > 0) {
    const sample = missingEvents.slice(0, 5).join(', ');
    issues.push(
      `dist/events missing ${missingEvents.length} module(s)` +
      (sample ? ` (${sample}${missingEvents.length > 5 ? ', ...' : ''})` : ''),
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    missingCommands,
    missingEvents,
  };
}

function shouldBuildTs() {
  if (process.env.TS_BUILD_ON_START === '1') {
    return { shouldBuild: true, reason: 'TS_BUILD_ON_START=1' };
  }

  const health = getDistHealth();
  if (!health.ok) {
    return { shouldBuild: true, reason: `dist artifacts incomplete (${health.issues.join('; ')})` };
  }

  const distMtime = fs.statSync(DIST_ENTRY).mtimeMs;
  const srcMtime = getNewestSourceMtimeMs(SRC_DIR);
  if (srcMtime > distMtime) {
    return { shouldBuild: true, reason: 'source files are newer than dist/index.js' };
  }

  if (process.env.SKIP_TS_BUILD === '1') {
    return { shouldBuild: false, reason: 'SKIP_TS_BUILD=1' };
  }

  return { shouldBuild: false, reason: 'dist is current' };
}

function hasTsTooling() {
  return fs.existsSync(LOCAL_TSC) && fs.existsSync(LOCAL_NODE_TYPES);
}

async function ensureTsTooling() {
  if (hasTsTooling()) return;
  console.log('[bootstrap] TypeScript tooling missing; installing local build deps...');
  await runProcess(
    getNpmBinary(),
    ['install', '--no-save', '--no-package-lock', 'typescript', '@types/node'],
    'install typescript tooling',
  );
}

function runDeployCommands() {
  const deployScript = path.join(__dirname, 'scripts', 'deploy-commands.js');
  return runProcess(process.execPath, [deployScript], 'deploy-commands');
}

async function buildTsIfNeeded() {
  const decision = shouldBuildTs();
  if (!decision.shouldBuild) {
    console.log(`[bootstrap] skipping TypeScript build (${decision.reason}).`);
    return;
  }

  if (process.env.SKIP_TS_BUILD === '1') {
    console.warn(`[bootstrap] SKIP_TS_BUILD=1 ignored (${decision.reason}).`);
  }

  await ensureTsTooling();
  console.log(`[bootstrap] building TypeScript (npm run build:ts) because ${decision.reason}...`);
  await runProcess(getNpmBinary(), ['run', 'build:ts'], 'build:ts');

  const health = getDistHealth();
  if (!health.ok) {
    throw new Error(`dist validation failed after build: ${health.issues.join('; ')}`);
  }
}

async function restorePackageFilesIfNeeded() {
  if (process.env.DISABLE_GIT_AUTOCLEAN === '1') return;
  if (!fs.existsSync(path.join(__dirname, '.git'))) return;

  try {
    const { stdout } = await runProcessCapture(
      'git',
      ['status', '--porcelain', '--', 'package.json', 'package-lock.json'],
      'git status',
    );

    if (!stdout.trim()) return;

    console.log('[bootstrap] restoring package.json and package-lock.json to HEAD...');
    await runProcess(
      'git',
      ['restore', '--', 'package.json', 'package-lock.json'],
      'git restore package files',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[bootstrap] package file auto-restore skipped:', message);
  }
}

async function main() {
  try {
    await restorePackageFilesIfNeeded();
    await buildTsIfNeeded();
    await runDeployCommands();
    require(DIST_ENTRY);
  } catch (error) {
    if (process.env.ALLOW_SRC_RUNTIME_FALLBACK === '1') {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[bootstrap] startup failed; ALLOW_SRC_RUNTIME_FALLBACK=1 so starting src runtime:', message);
      require(path.join(__dirname, 'src', 'index.js'));
      return;
    }
    console.error('[bootstrap] startup failed:', error);
    process.exit(1);
  }
}

main();
