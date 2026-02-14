// Bootstrap runner for Apollo/Pterodactyl: optional slash-command deploy, then start the bot
// Configure via env:
// - DEPLOY_CMDS_ON_START=true to run deploy-commands.js at startup
// - EXIT_ON_DEPLOY_FAIL=true to stop on deploy errors

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...options });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    p.on('error', reject);
  });
}

function runCapture(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited with code ${code}: ${stderr || stdout}`)),
    );
    p.on('error', reject);
  });
}

function normalizeBranchName(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const unquoted = raw.replace(/^['"]+|['"]+$/g, '');
  return unquoted
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '');
}

async function gitRefExists(ref) {
  try {
    await runCapture('git', ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch (_) {
    return false;
  }
}

(async () => {
  // Optional Git pull on start
  const gitPullOnStart = String(process.env.GIT_PULL_ON_START || '').toLowerCase() === 'true';
  const gitResetHard = String(process.env.GIT_RESET_HARD || '').toLowerCase() === 'true';
  const gitStashOnStart = String(process.env.GIT_STASH_ON_START || '').toLowerCase() === 'true';
  const gitBranchRaw = process.env.GIT_BRANCH;
  const gitBranch = normalizeBranchName(gitBranchRaw);
  const cwd = process.cwd();
  const hasGit = fs.existsSync(path.join(cwd, '.git'));

  if (gitPullOnStart && hasGit) {
    console.log('[runner] GIT_PULL_ON_START=true → updating repository');
    try {
      const { stdout: statusOut } = await runCapture('git', ['status', '--porcelain']);
      const isDirty = statusOut.trim().length > 0;
      if (isDirty && !gitResetHard && !gitStashOnStart) {
        console.warn(
          '[runner] repo has local changes; set GIT_RESET_HARD=true to discard them (recommended for deploy) or GIT_STASH_ON_START=true to stash them before pulling',
        );
      }
      if (gitResetHard) {
        console.log('[runner] git reset --hard');
        await run('git', ['reset', '--hard']);
      } else if (isDirty && gitStashOnStart) {
        console.log('[runner] git stash push -u (autostash)');
        await run('git', ['stash', 'push', '-u', '-m', 'runner autostash']);
      }
      console.log('[runner] git fetch --all --prune');
      await run('git', ['fetch', '--all', '--prune']);
      if (gitBranch) {
        if (typeof gitBranchRaw === 'string' && gitBranchRaw !== gitBranch) {
          console.log(`[runner] normalized GIT_BRANCH from ${JSON.stringify(gitBranchRaw)} to ${JSON.stringify(gitBranch)}`);
        }
        const localRef = `refs/heads/${gitBranch}`;
        const remoteRef = `refs/remotes/origin/${gitBranch}`;
        const hasLocalBranch = await gitRefExists(localRef);
        const hasRemoteBranch = await gitRefExists(remoteRef);

        if (hasLocalBranch) {
          console.log(`[runner] git checkout ${gitBranch}`);
          await run('git', ['checkout', gitBranch]);
        } else if (hasRemoteBranch) {
          console.log(`[runner] git checkout --track origin/${gitBranch}`);
          await run('git', ['checkout', '--track', `origin/${gitBranch}`]);
        } else {
          const { stdout: branchListOut } = await runCapture('git', ['branch', '-a']);
          throw new Error(
            `requested branch "${gitBranch}" was not found locally or on origin.\nAvailable branches:\n${branchListOut.trim()}`,
          );
        }
      }
      console.log('[runner] git pull --ff-only');
      await run('git', ['pull', '--ff-only']);
      console.log('[runner] repository updated');
    } catch (err) {
      console.error('[runner] git update failed:', err?.message || err);
    }
  }

  // Clean install on start (always run by default, disable with NPM_CI_ON_START=false)
  const npmCiOnStart = String(process.env.NPM_CI_ON_START || 'true').toLowerCase() !== 'false';
  if (npmCiOnStart && fs.existsSync(path.join(cwd, 'package.json'))) {
    console.log('[runner] npm ci --omit=dev (clean install of dependencies)');
    try {
      await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev']);
      console.log('[runner] npm ci completed successfully');
    } catch (err) {
      console.error('[runner] npm ci failed:', err?.message || err);
    }
  }

  const deployOnStart = String(process.env.DEPLOY_CMDS_ON_START || '').toLowerCase() === 'true';
  const exitOnFail = String(process.env.EXIT_ON_DEPLOY_FAIL || '').toLowerCase() === 'true';

  if (deployOnStart) {
    console.log('[runner] DEPLOY_CMDS_ON_START=true → running deploy-commands.js');
    try {
      await run(process.execPath, ['deploy-commands.js']);
      console.log('[runner] deploy-commands.js finished successfully');
    } catch (err) {
      console.error('[runner] deploy-commands.js failed:', err?.message || err);
      if (exitOnFail) process.exit(1);
    }
  }

  console.log('[runner] starting bot: src/index.js');
  require('./index');
})();
