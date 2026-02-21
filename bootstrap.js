const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DIST_ENTRY = path.join(__dirname, 'dist', 'index.js');
const SRC_DIR = path.join(__dirname, 'src');
const LOCAL_TSC = path.join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc');
const LOCAL_NODE_TYPES = path.join(__dirname, 'node_modules', '@types', 'node', 'package.json');

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

function getNewestTsMtimeMs(dir) {
  let newest = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, getNewestTsMtimeMs(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) continue;
    const stat = fs.statSync(full);
    newest = Math.max(newest, stat.mtimeMs);
  }
  return newest;
}

function shouldBuildTs() {
  if (process.env.SKIP_TS_BUILD === '1') return false;
  if (process.env.TS_BUILD_ON_START === '1') return true;
  if (!fs.existsSync(DIST_ENTRY)) return true;
  const distMtime = fs.statSync(DIST_ENTRY).mtimeMs;
  const srcTsMtime = getNewestTsMtimeMs(SRC_DIR);
  return srcTsMtime > distMtime;
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
  if (!shouldBuildTs()) return;
  await ensureTsTooling();
  console.log('[bootstrap] building TypeScript (npm run build:ts)...');
  await runProcess(getNpmBinary(), ['run', 'build:ts'], 'build:ts');
}

function resolveBotEntry(forceSrcRuntime = false) {
  if (!forceSrcRuntime && fs.existsSync(DIST_ENTRY)) return DIST_ENTRY;
  return path.join(__dirname, 'src', 'index.js');
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
  let forceSrcRuntime = false;
  try {
    await restorePackageFilesIfNeeded();

    try {
      await buildTsIfNeeded();
    } catch (error) {
      forceSrcRuntime = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[bootstrap] TypeScript build failed; falling back to src runtime:', message);
    }

    await runDeployCommands();
    require(resolveBotEntry(forceSrcRuntime));
  } catch (error) {
    console.error('[bootstrap] startup failed:', error);
    process.exit(1);
  }
}

main();
