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

function findCaseInsensitiveMatch(items, target) {
  const normalizedTarget = String(target || '').toLowerCase();
  if (!normalizedTarget) return '';
  const exact = items.find((item) => item === target);
  if (exact) return exact;
  return items.find((item) => String(item).toLowerCase() === normalizedTarget) || '';
}

async function listRemoteBranchNames() {
  try {
    const { stdout } = await runCapture('git', ['ls-remote', '--heads', 'origin']);
    const names = String(stdout || '')
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/refs\/heads\/(.+)$/);
        return match ? match[1].trim() : '';
      })
      .filter(Boolean);
    return [...new Set(names)];
  } catch (_) {
    return [];
  }
}

async function listLocalBranchNames() {
  try {
    const { stdout } = await runCapture('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    const names = String(stdout || '')
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    return [...new Set(names)];
  } catch (_) {
    return [];
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
        let resolvedBranch = gitBranch;
        if (typeof gitBranchRaw === 'string' && gitBranchRaw !== resolvedBranch) {
          console.log(`[runner] normalized GIT_BRANCH from ${JSON.stringify(gitBranchRaw)} to ${JSON.stringify(resolvedBranch)}`);
        }

        const localBranches = await listLocalBranchNames();
        const localCaseMatch = findCaseInsensitiveMatch(localBranches, resolvedBranch);
        if (localCaseMatch && localCaseMatch !== resolvedBranch) {
          console.log(`[runner] matched local branch case: ${JSON.stringify(resolvedBranch)} -> ${JSON.stringify(localCaseMatch)}`);
          resolvedBranch = localCaseMatch;
        }

        let localRef = `refs/heads/${resolvedBranch}`;
        let remoteRef = `refs/remotes/origin/${resolvedBranch}`;
        let hasLocalBranch = await gitRefExists(localRef);
        let hasRemoteBranch = await gitRefExists(remoteRef);

        if (!hasLocalBranch && !hasRemoteBranch) {
          const remoteBranches = await listRemoteBranchNames();
          const remoteCaseMatch = findCaseInsensitiveMatch(remoteBranches, resolvedBranch);
          if (remoteCaseMatch && remoteCaseMatch !== resolvedBranch) {
            console.log(`[runner] matched remote branch case: ${JSON.stringify(resolvedBranch)} -> ${JSON.stringify(remoteCaseMatch)}`);
            resolvedBranch = remoteCaseMatch;
            localRef = `refs/heads/${resolvedBranch}`;
            remoteRef = `refs/remotes/origin/${resolvedBranch}`;
          }
          if (remoteCaseMatch) {
            console.log(`[runner] git fetch origin refs/heads/${resolvedBranch}:refs/remotes/origin/${resolvedBranch}`);
            await run('git', ['fetch', 'origin', `refs/heads/${resolvedBranch}:refs/remotes/origin/${resolvedBranch}`]);
            hasLocalBranch = await gitRefExists(localRef);
            hasRemoteBranch = await gitRefExists(remoteRef);
          }
        }

        if (hasLocalBranch) {
          console.log(`[runner] git checkout ${resolvedBranch}`);
          await run('git', ['checkout', resolvedBranch]);
        } else if (hasRemoteBranch) {
          const remoteBranchRef = `origin/${resolvedBranch}`;
          console.log(`[runner] git checkout -B ${resolvedBranch} --track ${remoteBranchRef}`);
          try {
            await run('git', ['checkout', '-B', resolvedBranch, '--track', remoteBranchRef]);
          } catch (trackErr) {
            // Some providers expose a remote ref that resolves to a commit but is not typed as a branch,
            // so `--track` fails even though checkout from origin/<branch> is valid.
            console.warn(
              `[runner] tracking setup failed for ${remoteBranchRef}; retrying checkout without --track and setting upstream if possible`,
            );
            console.log(`[runner] git checkout -B ${resolvedBranch} ${remoteBranchRef}`);
            await run('git', ['checkout', '-B', resolvedBranch, remoteBranchRef]);

            try {
              console.log(`[runner] git branch --set-upstream-to=${remoteBranchRef} ${resolvedBranch}`);
              await run('git', ['branch', `--set-upstream-to=${remoteBranchRef}`, resolvedBranch]);
            } catch (upstreamErr) {
              console.warn(
                `[runner] could not set upstream to ${remoteBranchRef}; continuing without upstream (${upstreamErr?.message || upstreamErr})`,
              );
            }
          }
        } else {
          const { stdout: branchListOut } = await runCapture('git', ['branch', '-a']);
          throw new Error(
            `requested branch "${resolvedBranch}" was not found locally or on origin.\nAvailable branches:\n${branchListOut.trim()}`,
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
