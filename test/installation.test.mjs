import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, defaults, validateConfig } from '../lib/config.mjs';
import { createUiServer } from '../lib/ui-server.mjs';

const run = promisify(execFile);

test('fresh installations have private identities, and initializing again preserves them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pocket-connect-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function initialize(name) {
    const dir = join(root, name);
    const { stdout } = await run(process.execPath, [join(ROOT, 'bin/connect.mjs'), 'init'], {
      cwd: ROOT, env: { ...process.env, CONNECT_DATA_DIR: dir }
    });
    const config = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    assert.ok(!stdout.includes(config.gateway.updateToken));
    return config;
  }
  const first = await initialize('first');
  const second = await initialize('second');
  assert.notEqual(first.profiles[0].id, second.profiles[0].id);
  assert.notEqual(first.gateway.updateToken, second.gateway.updateToken);
  for (const config of [first, second]) {
    assert.equal(config.gateway.url, '');
    assert.equal(config.gateway.accountId, '');
    assert.equal(config.gateway.namespaceId, '');
    assert.match(config.gateway.workerName, /^dsh-pocket-connect-[a-f0-9]{6}$/);
    assert.equal(config.autoStart, false);
  }
  assert.deepEqual(await initialize('first'), first);
  const example = JSON.parse(await readFile(join(ROOT, 'connect.example.json'), 'utf8'));
  assert.throws(() => validateConfig(example));
});

test('QR endpoints isolate users and profiles while surviving destination and label changes', async t => {
  async function panel() {
    const config = defaults();
    // Even with a shared gateway, separate installations must not share entry URLs.
    config.gateway.url = 'https://gateway.example.test';
    const app = await createUiServer({ config, port: 0, persistInstance: false, save: async () => {} });
    t.after(() => app.close());
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const headers = { 'X-Connect-Token': app.token, 'Content-Type': 'application/json' };
    async function qr(id) {
      const response = await fetch(`${origin}/api/qr?id=${id}`, { headers });
      assert.equal(response.status, 200);
      return response.text();
    }
    async function profile(body) {
      const response = await fetch(`${origin}/api/profile`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      return response.json();
    }
    return { app, qr, profile, id: config.profiles[0].id };
  }
  const first = await panel();
  const second = await panel();
  const original = await first.qr(first.id);
  assert.notEqual(original, await second.qr(second.id));
  await first.profile({ id: first.id, name: 'Renamed', source: { type: 'manual', url: 'https://new-destination.example.test/' } });
  assert.equal(await first.qr(first.id), original);
  const added = await first.profile({ name: 'Another service', source: { type: 'manual', url: 'https://other.example.test/' } });
  assert.notEqual(added.id, first.id);
  assert.notEqual(await first.qr(added.id), original);
  assert.equal(await first.qr(first.id), original);
});
