const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DIST_ENTRY = path.join(__dirname, 'dist', 'index.js');
const SRC_DIR = path.join(__dirname, 'src');

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

function runDeployCommands() {
  const deployScript = path.join(__dirname, 'scripts', 'deploy-commands.js');
  return runProcess(process.execPath, [deployScript], 'deploy-commands');
}

async function buildTsIfNeeded() {
  if (!shouldBuildTs()) return;
  console.log('[bootstrap] building TypeScript (npm run build:ts)...');
  await runProcess(getNpmBinary(), ['run', 'build:ts'], 'build:ts');
}

function resolveBotEntry() {
  if (fs.existsSync(DIST_ENTRY)) return DIST_ENTRY;
  return path.join(__dirname, 'src', 'index.js');
}

async function main() {
  try {
    await buildTsIfNeeded();
    await runDeployCommands();
    require(resolveBotEntry());
  } catch (error) {
    console.error('[bootstrap] startup failed:', error);
    process.exit(1);
  }
}

main();
