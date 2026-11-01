import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../cloudflare/worker.mjs';

const SECRET = 'test-only-connect-secret-0123456789abcdef';
const ID = 'test_entry_0123456789abcdef';
function fixture() {
  const data = new Map();
  const env = { UPDATE_TOKEN: SECRET, CONNECT_KV: {
    async get(key) { return data.has(key) ? JSON.parse(data.get(key)) : null; },
    async put(key, value) { data.set(key, value); }
  } };
  const request = (path, options = {}, extra = {}) => handleRequest(new Request(`https://entry.example${path}`, options), { ...env, ...extra }, { now: () => 100000 });
  const put = (body, token = SECRET) => request(`/api/links/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { env, data, request, put };
}

test('one fixed entry follows two tunnel URLs without cached redirects', async () => {
  const f = fixture();
  for (const url of ['https://first.trycloudflare.com/', 'https://second.trycloudflare.com/app?mode=mobile']) {
    assert.equal((await f.put({ url, label: 'DSH' })).status, 200);
    const response = await f.request(`/r/${ID}?token=do-not-forward`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), url);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('updates require the secret and fail closed before deployment is configured', async () => {
  const f = fixture();
  assert.equal((await f.put({ url: 'https://first.trycloudflare.com' }, 'wrong')).status, 401);
  assert.equal(f.data.size, 0);
  const noSecret = await f.request(`/api/links/${ID}`, { method: 'PUT' }, { UPDATE_TOKEN: '' });
  assert.equal(noSecret.status, 503);
});

test('invalid protocols, embedded credentials, leases and oversized bodies are rejected', async () => {
  const f = fixture();
  for (const url of ['javascript:alert(1)', 'http://unsafe.example', 'https://user:pass@example.com', 'garbage']) assert.equal((await f.put({ url })).status, 400);
  assert.equal((await f.put({ url: 'https://example.com', leaseSeconds: -1 })).status, 400);
  assert.equal((await f.put({ url: 'https://example.com', label: 'x'.repeat(9000) })).status, 400);
  assert.equal(f.data.size, 0);
});

test('offline and expired leases display a retrying page without leaking a stale URL', async () => {
  const f = fixture();
  await f.put({ url: 'https://expired.example', label: '<script>alert(1)</script>', leaseSeconds: 60 });
  const expired = await handleRequest(new Request(`https://entry.example/r/${ID}`), f.env, { now: () => 160001 });
  assert.equal(expired.status, 503);
  const html = await expired.text();
  assert.match(html, /http-equiv="refresh"/);
  assert.ok(!html.includes('https://expired.example'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  await f.put({ url: null, label: 'DSH' });
  assert.equal((await f.request(`/r/${ID}`)).status, 503);
});

test('manual entries can remain valid without a running sync process', async () => {
  const f = fixture();
  await f.put({ url: 'https://example.com/', leaseSeconds: 0 });
  const response = await handleRequest(new Request(`https://entry.example/r/${ID}`), f.env, { now: () => 999999999999 });
  assert.equal(response.status, 302);
});

test('host allow list and API method restrictions hold', async () => {
  const f = fixture();
  const response = await f.request(`/api/links/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ url: 'https://allowed.trycloudflare.com.evil.example' }) }, { ALLOWED_HOSTS: '*.trycloudflare.com' });
  assert.equal(response.status, 400);
  assert.equal((await f.request(`/r/${ID}`, { method: 'POST' })).status, 405);
  assert.equal((await f.request('/api/links/short', { headers: { Authorization: `Bearer ${SECRET}` } })).status, 400);
  assert.equal((await f.request('/api/links', { headers: { Authorization: `Bearer ${SECRET}` } })).status, 404);
});

test('health announces identity and configuration, never the secret', async () => {
  const f = fixture();
  const health = await f.request('/health');
  const text = await health.text();
  assert.equal(JSON.parse(text).ready, true);
  assert.ok(!text.includes(SECRET));
});
