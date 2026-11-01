import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { DATA, ROOT, readConfig, saveConfig, validateConfig, publicConfig, newProfile } from './config.mjs';
import { entryUrl, VERSION, publicUrl } from './shared.mjs';
import { createSource } from './sources.mjs';
import { AgentManager, Publisher } from './agent.mjs';
import * as cloudflare from './cloudflare.mjs';

export async function openBrowser(url) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('浏览器地址必须使用 HTTP 或 HTTPS');
  // Hide only the helper console. ShellExecute must show the browser normally.
  // .NET avoids PowerShell module autoload problems in inherited environments.
  const windowsScript = "$ErrorActionPreference='Stop'; try { $connectBrowser=[System.Diagnostics.ProcessStartInfo]::new(); $connectBrowser.FileName=$env:CONNECT_OPEN_URL; $connectBrowser.UseShellExecute=$true; $connectBrowser.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Normal; [void][System.Diagnostics.Process]::Start($connectBrowser) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  return new Promise((resolveOpened, reject) => {
    const child = process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsScript], { env: { ...process.env, CONNECT_OPEN_URL: target.toString() }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target.toString()], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('打开浏览器超时')); }, 10000);
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-1500); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolveOpened();
      else reject(new Error(errorText.trim() || `浏览器启动失败（${code}）`));
    });
  });
}

function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function bodyJson(req) {
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (Buffer.byteLength(content) > 65536) throw new Error('请求内容过大');
  }
  return content ? JSON.parse(content) : {};
}

export async function createUiServer({ config: initial, save = saveConfig, token = randomBytes(24).toString('base64url'), port = 4178, persistInstance = true } = {}) {
  let config = initial || await readConfig();
  let operation = { busy: false, title: '', error: '' };
  let account = { checked: false, loggedIn: false, accounts: [] };
  let closing = false;
  const logs = [];
  function log(message) {
    let clean = String(message).replaceAll(config.gateway.updateToken, '***');
    clean = clean.replace(/([?&](?:token|code|key|password)=)[^&\s]+/gi, '$1***');
    logs.push({ at: Date.now(), message: clean.slice(0, 1600) });
    if (logs.length > 100) logs.shift();
  }
  const manager = new AgentManager(() => config, log);
  const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
  const server = createServer(async (req, res) => {
    const host = req.headers.host || '';
    const actualPort = server.address()?.port;
    if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(host)) { res.writeHead(403); res.end('Forbidden host'); return; }
    const origin = `http://${host}`;
    const url = new URL(req.url, origin);
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    };
    const json = (value, status = 200) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (files.has(url.pathname) && req.method === 'GET') {
        const [name, type] = files.get(url.pathname);
        res.writeHead(200, { ...headers, 'Content-Type': `${type}; charset=utf-8` });
        res.end(await readFile(resolve(ROOT, 'ui', name))); return;
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204, headers); res.end(); return; }
      if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      if (req.headers.origin && req.headers.origin !== origin) return json({ error: 'Origin rejected' }, 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') return json({ error: 'Cross-site request rejected' }, 403);
      if (!equalSecret(req.headers['x-connect-token'], token)) return json({ error: '请通过“快速开始.cmd”重新打开本机面板' }, 401);
      if (url.pathname === '/api/state' && req.method === 'GET') return json({ app: 'connect-fixed-entry', version: VERSION, config: publicConfig(config), agents: manager.snapshots(), operation, account, logs });
      if (url.pathname === '/api/qr' && req.method === 'GET') {
        const profile = config.profiles.find(p => p.id === url.searchParams.get('id'));
        if (!profile || !config.gateway.url) return json({ error: '请先部署入口服务' }, 400);
        const svg = await QRCode.toString(entryUrl(config.gateway.url, profile.id), { type: 'svg', margin: 2, width: 260, errorCorrectionLevel: 'M' });
        res.writeHead(200, { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(svg); return;
      }
      if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await bodyJson(req);
      if (operation.busy && !['/api/stop'].includes(url.pathname)) return json({ error: '当前操作进行中，请稍候' }, 409);
      if (url.pathname === '/api/config') {
        const next = structuredClone(config);
        if (body.gateway) {
          for (const key of ['workerName', 'accountId', 'namespaceId', 'url']) if (Object.hasOwn(body.gateway, key)) next.gateway[key] = String(body.gateway[key]).trim();
          if (body.gateway.updateToken) next.gateway.updateToken = String(body.gateway.updateToken).trim();
        }
        if (Object.hasOwn(body, 'autoStart')) next.autoStart = body.autoStart === true;
        validateConfig(next);
        const connectionChanged = next.gateway.url !== config.gateway.url || next.gateway.updateToken !== config.gateway.updateToken;
        const runningIds = [...manager.agents].filter(([, agent]) => agent.status.running).map(([id]) => id);
        // A failed disk write must not interrupt a working connection.
        await save(next);
        config = next;
        // Auto-start and deployment metadata do not affect running connections.
        if (connectionChanged) {
          await Promise.all(runningIds.map(id => manager.stop(id, { offline: false })));
          for (const id of runningIds) manager.start(id);
        }
        log('服务配置已保存。');
        return json({ ok: true, autoStart: config.autoStart, savedAt: Date.now() });
      }
      if (url.pathname === '/api/profile') {
        const next = structuredClone(config);
        const existing = body.id ? next.profiles.find(p => p.id === body.id) : null;
        if (body.id && !existing) throw new Error('入口不存在');
        const profile = existing || newProfile(body.name || '新入口');
        profile.name = String(body.name || profile.name).trim();
        if (body.source) profile.source = body.source;
        for (const field of ['intervalSeconds', 'heartbeatSeconds', 'leaseSeconds', 'offlineGraceSeconds']) if (Object.hasOwn(body, field)) profile[field] = Number(body[field]);
        if (!existing) next.profiles.push(profile);
        validateConfig(next);
        await manager.stop(profile.id);
        await save(next); config = next; log(`${profile.name}：配置已保存。`);
        return json({ ok: true, id: profile.id });
      }
      if (url.pathname === '/api/remove') {
        await manager.stop(body.id);
        const profile = config.profiles.find(p => p.id === body.id);
        if (profile && config.gateway.url) await new Publisher(config.gateway).publish(profile, null);
        const next = structuredClone(config); next.profiles = next.profiles.filter(p => p.id !== body.id);
        await save(next); config = next;
        return json({ ok: true });
      }
      if (url.pathname === '/api/test') {
        const profile = { ...newProfile('测试'), source: body.source };
        validateConfig({ ...config, profiles: [profile] });
        const result = await createSource(body.source).read();
        return json({ ok: true, url: result.url ? publicUrl(result.url) : null, note: result.note });
      }
      if (url.pathname === '/api/start') {
        manager.start(body.id);
        return json({ ok: true });
      }
      if (url.pathname === '/api/stop') { await manager.stop(body.id); return json({ ok: true }); }
      if (url.pathname === '/api/check-cloud') {
        account = { ...await cloudflare.whoami(), checked: true };
        return json({ ok: true });
      }
      if (url.pathname === '/api/login' || url.pathname === '/api/deploy') {
        const action = url.pathname === '/api/login' ? 'login' : 'deploy';
        if (action === 'deploy') {
          validateConfig(config);
          await manager.stopAll({ offline: false });
        }
        operation = { busy: true, title: action === 'login' ? '等待 Cloudflare 浏览器授权' : '正在部署固定入口', error: '' };
        void (async () => {
          try {
            if (action === 'login') account = { ...await cloudflare.login(log), checked: true };
            else {
              await cloudflare.deploy(config, { log, save });
              if (config.autoStart) for (const p of config.profiles) manager.start(p.id);
            }
            operation = { busy: false, title: '操作完成', error: '' };
          } catch (error) { log(error.message); operation = { busy: false, title: '操作未完成', error: error.message }; }
        })();
        return json({ ok: true, pending: true });
      }
      if (url.pathname === '/api/shutdown') {
        json({ ok: true });
        void close(); return;
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) { json({ error: error.message || '操作失败' }, 400); }
  });
  await new Promise((resolveListening, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListening); });
  const actualPort = server.address().port;
  const url = `http://127.0.0.1:${actualPort}/#${token}`;
  if (persistInstance) {
    await mkdir(DATA, { recursive: true });
    await writeFile(join(DATA, 'instance.json'), JSON.stringify({ pid: process.pid, port: actualPort, token }), { mode: 0o600 });
  }
  async function close() {
    if (closing) return;
    closing = true;
    await manager.stopAll();
    await new Promise(resolveClose => { server.close(resolveClose); server.closeIdleConnections(); });
    if (persistInstance) await rm(join(DATA, 'instance.json'), { force: true });
  }
  if (config.autoStart && config.gateway.url) for (const profile of config.profiles) manager.start(profile.id);
  return { server, url, token, manager, close, getConfig: () => config };
}
