import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncAgent, Publisher } from '../lib/agent.mjs';
import { newProfile } from '../lib/config.mjs';

test('polls do not write until a URL changes or renewal is due', async () => {
  const profile = newProfile();
  let now = 100000, url = 'https://first.trycloudflare.com/';
  const writes = [];
  const agent = new SyncAgent(profile, {}, { now: () => now, source: { async read() { return { url }; } }, publisher: { async publish(p, target) { writes.push(target); } } });
  await agent.tick();
  now += 10000; await agent.tick();
  assert.deepEqual(writes, [url]);
  now += profile.heartbeatSeconds * 1000; await agent.tick();
  assert.equal(writes.length, 2);
  url = 'https://second.trycloudflare.com/'; now += 10000; await agent.tick();
  assert.equal(writes.at(-1), url);
});

test('temporary source failures receive grace; prolonged failures invalidate the target once', async () => {
  const profile = newProfile();
  let now = 100000, available = true;
  const writes = [];
  const agent = new SyncAgent(profile, {}, { now: () => now, source: { async read() { if (!available) throw new Error('offline'); return { url: 'https://first.trycloudflare.com/' }; } }, publisher: { async publish(p, target) { writes.push(target); } } });
  await agent.tick(); available = false;
  now += 10000; await agent.tick(); assert.equal(writes.length, 1);
  now += 30001; await agent.tick(); assert.equal(writes.at(-1), null);
  now += 10000; await agent.tick(); assert.equal(writes.length, 2);
  available = true; now += 10000; await agent.tick(); assert.equal(writes.at(-1), 'https://first.trycloudflare.com/');
});

test('a failed upload is retried, including when the source URL stays unchanged', async () => {
  const profile = newProfile();
  let attempts = 0;
  const agent = new SyncAgent(profile, {}, { source: { async read() { return { url: 'https://first.trycloudflare.com/' }; } }, publisher: { async publish() { if (++attempts === 1) throw new Error('network'); } } });
  await assert.rejects(agent.tick(), /network/);
  await agent.tick(); assert.equal(attempts, 2);
});

test('publisher sends only selected fields, not DSH access passwords or the full status', async () => {
  const profile = newProfile();
  let sent;
  const publisher = new Publisher({ url: 'https://entry.example', updateToken: 'secret' }, async (url, options) => {
    sent = { url: String(url), ...options };
    return new Response(JSON.stringify({ ok: true }));
  });
  await publisher.publish(profile, 'https://target.example/');
  const payload = JSON.parse(sent.body);
  assert.deepEqual(Object.keys(payload).sort(), ['label', 'leaseSeconds', 'url']);
  assert.equal(sent.redirect, 'error');
  assert.equal(sent.headers.Authorization, 'Bearer secret');
});
