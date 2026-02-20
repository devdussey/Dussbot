const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadCommands } = require('../src/handlers/commandHandler');
const { executeCommandSafely } = require('../src/utils/commandExecutionGuard');

test('malformed command is logged and skipped', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmds-'));
  const badFile = path.join(tmpDir, 'malformed.test.js');
  fs.writeFileSync(badFile, 'module.exports = { data: { name: "bad" }, execute() { }');
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    const client = { commands: new Map() };
    assert.doesNotThrow(() => loadCommands(client, tmpDir));
    assert(!client.commands.has('bad'));
    assert(logs.some(l => l.includes('Failed to load command') && l.includes('malformed.test.js')));
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function createInteraction() {
  const calls = [];
  return {
    replied: false,
    deferred: false,
    async reply(payload) {
      calls.push({ method: 'reply', payload });
    },
    async editReply(payload) {
      calls.push({ method: 'editReply', payload });
    },
    async followUp(payload) {
      calls.push({ method: 'followUp', payload });
    },
    getCalls() {
      return calls;
    },
  };
}

test('executeCommandSafely replies and records failure callback on command error', async () => {
  const interaction = createInteraction();
  const err = new Error('boom');
  let captured = null;
  const command = {
    async execute() {
      throw err;
    },
  };

  const result = await executeCommandSafely({
    interaction,
    command,
    onFailure: async (error) => {
      captured = error;
    },
  });

  assert.equal(result, false);
  assert.equal(captured, err);
  const calls = interaction.getCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'reply');
  assert.equal(calls[0].payload.content, 'There was an error while executing this command!');
});
