import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createSource, lastUrl, tailFile } from '../lib/sources.mjs';
import { CookieSession } from '../lib/network.mjs';

test('log source follows the last URL, handles rotation, and accepts a custom capture group', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'connect-source-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'tunnel.log');
  await writeFile(path, `${'noise '.repeat(50000)}\nhttps://old.trycloudflare.com\nhttps://new.trycloudflare.com\n`);
  const source = createSource({ type: 'file', file: path });
  assert.equal((await source.read()).url, 'https://new.trycloudflare.com/');
  assert.ok((await tailFile(path)).length <= 256 * 1024);
  await writeFile(path, 'https://after-rotation.trycloudflare.com');
  assert.equal((await source.read()).url, 'https://after-rotation.trycloudflare.com/');
  assert.equal(lastUrl('public_url="https://example.net/app"', 'public_url="(https://[^" ]+)"'), 'https://example.net/app');
});

test('JSON source supports nested arrays and reports a missing tunnel', async () => {
  const source = createSource({ type: 'json', endpoint: 'https://status.example', path: 'tunnels.0.public_url' }, { fetcher: async () => new Response(JSON.stringify({ tunnels: [{ public_url: 'https://tunnel.example' }] })) });
  assert.equal((await source.read()).url, 'https://tunnel.example/');
  const missing = createSource({ type: 'json', endpoint: 'https://status.example', path: 'url' }, { fetcher: async () => new Response('{}') });
  assert.equal((await missing.read()).url, null);
});

test('DSH source obtains Pocket and DSH cookies, then reauthenticates after a restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'connect-dsh-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'dsh-pocket')); await writeFile(join(dir, 'dsh-pocket', 'token-lan'), 'LocalPin123');
  let generation = 1, tunnel = 'https://first.trycloudflare.com';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const cookies = req.headers.cookie || '';
    if (url.pathname === '/' && url.searchParams.get('token') === 'LocalPin123') {
      res.writeHead(303, { 'Set-Cookie': `pocket=p${generation}; HttpOnly; Path=/`, Location: '/' }); res.end(); return;
    }
    if (url.pathname === '/' && cookies.includes(`pocket=p${generation}`)) {
      res.writeHead(200, { 'Set-Cookie': `dsh=d${generation}; HttpOnly; Path=/`, 'Content-Type': 'text/html' }); res.end('<meta http-equiv="refresh" content="0;url=/">'); return;
    }
    if (url.pathname === '/dsh-pocket/pocket.status' && cookies.includes(`pocket=p${generation}`) && cookies.includes(`dsh=d${generation}`)) {
      let body = ''; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      assert.equal(request.method, 'pocket.status');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { tunnelRunning: Boolean(tunnel), tunnelUrl: tunnel, accessToken: 'never-upload-this' } } })); return;
    }
    res.writeHead(401); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const source = createSource({ type: 'dsh-pocket', baseUrl: `http://127.0.0.1:${server.address().port}`, homeDir: dir });
  assert.equal((await source.read()).url, 'https://first.trycloudflare.com/');
  generation++; tunnel = 'https://second.trycloudflare.com';
  assert.equal((await source.read()).url, 'https://second.trycloudflare.com/');
  tunnel = null; assert.equal((await source.read()).url, null);
});

test('local cookie handshake never follows a redirect to another origin', async () => {
  let calls = 0;
  const session = new CookieSession('http://127.0.0.1:3081', async () => {
    calls++; return new Response(null, { status: 302, headers: { Location: 'https://other.example/', 'Set-Cookie': 'private=value; Path=/' } });
  });
  await assert.rejects(session.request('/'), /其他站点/);
  assert.equal(calls, 1);
});
