import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUiServer } from '../lib/ui-server.mjs';
import { defaults, readConfig, saveConfig } from '../lib/config.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-save-'));
  const path = join(dir, 'config.json');
  const updates = [];
  const gateway = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    updates.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const config = defaults();
  config.gateway.url = `http://127.0.0.1:${gateway.address().port}`;
  config.profiles[0].source = { type: 'manual', url: 'https://test-target.example/' };
  await saveConfig(config, path);
  let failSave = false;
  const app = await createUiServer({ config, port: 0, persistInstance: false, save: async next => {
    if (failSave) throw new Error('simulated disk failure');
    await saveConfig(next, path);
  } });
  t.after(async () => {
    await app.close();
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const id = config.profiles[0].id;
  app.manager.start(id);
  await app.manager.agents.get(id).ticking;
  const agent = app.manager.agents.get(id);
  assert.equal(agent.status.state, 'online');
  async function save(body) {
    return fetch(`http://127.0.0.1:${app.server.address().port}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Connect-Token': app.token }, body: JSON.stringify(body)
    });
  }
  return { app, id, agent, updates, save, path, setFailure: value => { failSave = value; } };
}

test('saving service options persists the checkbox without stopping active sync', async t => {
  const f = await fixture(t);
  const response = await f.save({ autoStart: true });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.autoStart, true);
  assert.equal((await readConfig(f.path)).autoStart, true);
  assert.equal(f.app.manager.agents.get(f.id), f.agent);
  assert.equal(f.agent.status.running, true);
  assert.equal(f.agent.status.state, 'online');
  assert.equal(f.updates.length, 1);
  assert.ok(f.updates.every(update => update.url !== null));
});

test('a failed configuration write preserves the saved settings and running sync', async t => {
  const f = await fixture(t);
  f.setFailure(true);
  const response = await f.save({ autoStart: true });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /disk failure/);
  assert.equal((await readConfig(f.path)).autoStart, false);
  assert.equal(f.app.getConfig().autoStart, false);
  assert.equal(f.agent.status.running, true);
  assert.equal(f.updates.length, 1);
});

test('changing gateway credentials reconnects active sync without marking the entry offline', async t => {
  const f = await fixture(t);
  const response = await f.save({ gateway: { updateToken: 'new-test-only-secret-0123456789abcdef' } });
  assert.equal(response.status, 200);
  const replacement = f.app.manager.agents.get(f.id);
  await replacement.ticking;
  assert.notEqual(replacement, f.agent);
  assert.equal(replacement.status.running, true);
  assert.equal(replacement.status.state, 'online');
  assert.equal(f.updates.length, 2);
  assert.ok(f.updates.every(update => update.url !== null));
});
