import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiServer } from '../lib/ui-server.mjs';
import { defaults, publicConfig, validateConfig, saveConfig, readConfig } from '../lib/config.mjs';
import { parseWhoami } from '../lib/cloudflare.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('local UI requires its session key and rejects cross-origin mutations', async t => {
  const config = defaults();
  const app = await createUiServer({ config, port: 0, persistInstance: false, save: async () => {} });
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { 'X-Connect-Token': app.token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin}/api/config`, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body: '{}' })).status, 403);
  const response = await fetch(`${origin}/api/state`, { headers });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.app, 'connect-fixed-entry');
  assert.ok(!JSON.stringify(state).includes(config.gateway.updateToken));
  const invalid = await fetch(`${origin}/api/profile`, { method: 'POST', headers, body: JSON.stringify({ name: 'wrong', source: { type: 'dsh-pocket', baseUrl: 'https://remote.example' } }) });
  assert.equal(invalid.status, 400);
});

test('configuration round trip preserves entry IDs and never exposes the update secret', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'connect-config-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const config = defaults();
  config.gateway.url = 'https://connect.user.workers.dev';
  await saveConfig(config, join(dir, 'config.json'));
  const read = await readConfig(join(dir, 'config.json'));
  assert.equal(read.profiles[0].id, config.profiles[0].id);
  assert.match(publicConfig(read).profiles[0].entryUrl, new RegExp(`/r/${config.profiles[0].id}$`));
  assert.ok(!JSON.stringify(publicConfig(read)).includes(config.gateway.updateToken));
  assert.throws(() => validateConfig({ ...read, profiles: [read.profiles[0], read.profiles[0]] }), /重复/);
});

test('Cloudflare whoami output is reduced to login status and account names only', () => {
  const result = parseWhoami('notice\n' + JSON.stringify({ loggedIn: true, apiToken: 'do-not-expose', accounts: [{ id: '123', name: 'Example', token: 'private' }] }));
  assert.deepEqual(result, { loggedIn: true, accounts: [{ id: '123', name: 'Example' }] });
});
