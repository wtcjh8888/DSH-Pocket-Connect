import { readFile, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CookieSession, timedFetch, limitedText } from './network.mjs';
import { readJsonPath, validateTarget } from './shared.mjs';

function found(value, note = '') {
  if (value === undefined || value === null || value === '') return { url: null, note: note || '尚未获取到公网地址' };
  return { url: validateTarget(value), note };
}

export class DshPocketSource {
  constructor(config, { fetcher = timedFetch } = {}) {
    this.config = config;
    this.session = new CookieSession(config.baseUrl, fetcher);
    this.home = config.homeDir || process.env.DSH_HOME || join(homedir(), '.dsh');
  }
  async rpc() {
    const method = 'pocket.status';
    const response = await this.session.request('/dsh-pocket/pocket.status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: {} })
    });
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`DSH 状态接口返回 ${response.status}；请检查代理端口及插件版本`); }
    let payload;
    try { payload = JSON.parse(await limitedText(response)); } catch { throw new Error('DSH 返回了登录页面；请检查代理地址及本机认证'); }
    const result = payload.result ?? payload;
    if (result.ok === false) throw new Error(result.error?.message || 'DSH 状态读取失败');
    const status = result.value ?? result;
    if (!Object.hasOwn(status, 'tunnelUrl') && !Object.hasOwn(status, 'tunnelRunning')) throw new Error('DSH 状态格式不兼容，请更新 DSH Pocket 或改用通用来源');
    return status;
  }
  async handshake() {
    let pin;
    try { pin = (await readFile(join(this.home, 'dsh-pocket', 'token-lan'), 'utf8')).trim(); } catch { /* LAN auth may be disabled. */ }
    if (pin && !/^[a-zA-Z0-9]{6,64}$/.test(pin)) throw new Error('本机 DSH 局域网密码文件格式不正确');
    this.session.clear();
    const path = pin ? `/?token=${encodeURIComponent(pin)}` : '/';
    const first = await this.session.request(path, { headers: { Accept: 'text/html' } });
    await first.body?.cancel();
    // Pocket can return a 200 meta-refresh page during the DSH cookie handshake.
    const second = await this.session.request('/', { headers: { Accept: 'text/html' } });
    await second.body?.cancel();
  }
  async read() {
    let status = await this.rpc();
    if (!status) { await this.handshake(); status = await this.rpc(); }
    if (!status) throw new Error('DSH 本机认证未通过；请检查 DSH_HOME、代理端口和局域网密码文件');
    if (status.tunnelRunning === false) return found(null, '等待你在 DSH Pocket 中开启公网访问');
    return found(status.tunnelUrl);
  }
}

export async function tailFile(path, maxBytes = 256 * 1024) {
  const handle = await open(resolve(path), 'r');
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

export function lastUrl(text, pattern) {
  const expression = new RegExp(pattern || 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com', 'g');
  let value;
  for (const match of text.matchAll(expression)) {
    const candidate = match[1] ?? match[0];
    try { value = validateTarget(candidate); } catch { /* Continue to the last valid match. */ }
  }
  return value ?? null;
}

export function createSource(source, options = {}) {
  if (source.type === 'dsh-pocket') return new DshPocketSource(source, options);
  if (source.type === 'manual') return { async read() { return found(source.url); } };
  if (source.type === 'file') return { async read() { return found(lastUrl(await tailFile(source.file), source.pattern), '日志中尚未找到匹配地址'); } };
  if (source.type === 'json') return {
    async read() {
      const response = await (options.fetcher || timedFetch)(source.endpoint, { headers: { Accept: 'application/json' }, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`JSON 地址接口返回 ${response.status}`); }
      let payload;
      try { payload = JSON.parse(await limitedText(response)); } catch { throw new Error('接口返回的不是有效 JSON'); }
      return found(readJsonPath(payload, source.path), `JSON 字段 ${source.path} 尚无有效地址`);
    }
  };
  throw new Error('不支持的地址来源');
}
