const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disphoriabot-vanity-role-'));
process.env.DISPHORIABOT_DATA_DIR = tempDir;
const { resetDataDirCache } = require('../src/utils/dataDir');
resetDataDirCache();

const modulePath = require.resolve('../src/utils/vanityRoleStore');
delete require.cache[modulePath];
const {
  getUserRecord,
  upsertUserRecord,
  deleteUserRecord,
} = require(modulePath);

test.after(() => {
  resetDataDirCache();
  delete process.env.DISPHORIABOT_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('getUserRecord returns null when missing', () => {
  assert.equal(getUserRecord('g1', 'u1'), null);
});

test('upsertUserRecord creates record and persists values', async () => {
  const saved = await upsertUserRecord('g1', 'u1', {
    roleId: 'r1',
    primary: '#FFFFFF',
    secondary: '#000000',
    active: 'secondary',
  });
  assert.deepEqual(saved, {
    roleId: 'r1',
    primary: '#FFFFFF',
    secondary: '#000000',
    active: 'secondary',
  });

  assert.deepEqual(getUserRecord('g1', 'u1'), saved);

  delete require.cache[modulePath];
  const reloaded = require(modulePath);
  assert.deepEqual(reloaded.getUserRecord('g1', 'u1'), saved);
});

test('upsertUserRecord sanitizes invalid types', async () => {
  const saved = await upsertUserRecord('g2', 'u2', {
    roleId: 123,
    primary: 456,
    secondary: null,
    active: 'nope',
  });
  assert.deepEqual(saved, {
    roleId: null,
    primary: null,
    secondary: null,
    active: 'primary',
  });
});

test('deleteUserRecord removes a record', async () => {
  await upsertUserRecord('g3', 'u3', { roleId: 'r3' });
  assert.ok(getUserRecord('g3', 'u3'));
  assert.equal(await deleteUserRecord('g3', 'u3'), true);
  assert.equal(getUserRecord('g3', 'u3'), null);
});

