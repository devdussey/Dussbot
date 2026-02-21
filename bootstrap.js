const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function resolveBotEntry() {
  const distEntry = path.join(__dirname, 'dist', 'index.js');
  if (fs.existsSync(distEntry)) return distEntry;
  return path.join(__dirname, 'src', 'index.js');
}

function runDeployCommands() {
  return new Promise((resolve, reject) => {
    const deployScript = path.join(__dirname, 'scripts', 'deploy-commands.js');
    const child = spawn(process.execPath, [deployScript], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`deploy-commands exited with code ${code}`));
    });
  });
}

async function main() {
  try {
    await runDeployCommands();
    require(resolveBotEntry());
  } catch (error) {
    console.error('[bootstrap] startup failed:', error);
    process.exit(1);
  }
}

main();
