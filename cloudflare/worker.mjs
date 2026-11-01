import { VERSION, LINK_ID, escapeHtml, validateTarget } from '../lib/shared.mjs';

const HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}

async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('authorization') ?? '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([`Bearer ${secret}`, supplied].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function smallJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('请使用 application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('请求内容不能为空');
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 8192) { await reader.cancel(); throw new Error('请求内容超过 8 KB'); }
    chunks.push(value);
  }
  const data = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) { data.set(chunk, at); at += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(data)); } catch { throw new Error('JSON 格式不正确'); }
}

function page(title, detail, { retry = false, status = 200, head = false } = {}) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${retry ? '<meta http-equiv="refresh" content="15">' : ''}<title>${escapeHtml(title)} · Connect</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#182537;font:16px/1.7 system-ui,sans-serif}main{margin:24px;padding:40px;max-width:480px;background:white;border:1px solid #e1e7ef;border-radius:24px;box-shadow:0 20px 70px #173d6a0b}.brand{color:#1b66ed;font-weight:750;letter-spacing:3px;font-size:13px}h1{font-size:28px;line-height:1.3}p{color:#64748b}.hint{font-size:13px;border-top:1px solid #edf0f5;padding-top:20px}</style></head><body><main><div class="brand">CONNECT</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>${retry ? '<p class="hint">固定入口仍然有效。页面每 15 秒重试；也可以稍后重新打开这个书签。</p>' : ''}</main></body></html>`;
  return new Response(head ? null : html, { status, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8', ...(retry ? { 'Retry-After': '15' } : {}) } });
}

export async function handleRequest(request, env, { now = Date.now } = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && ['GET', 'HEAD'].includes(request.method)) {
    return json({ app: 'connect-fixed-entry', version: VERSION, ready: Boolean(env.CONNECT_KV && env.UPDATE_TOKEN?.length >= 32) });
  }
  if (url.pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
    return page('一个入口，始终连接。', '请使用 Connect 为你生成的固定链接或二维码进入。', { head: request.method === 'HEAD' });
  }
  const api = url.pathname.match(/^\/api\/links\/([A-Za-z0-9_-]+)$/);
  if (api) {
    if (!env.UPDATE_TOKEN || env.UPDATE_TOKEN.length < 32) return json({ error: '服务尚未配置更新密钥' }, 503);
    if (!await authorized(request, env.UPDATE_TOKEN)) return json({ error: '更新密钥无效' }, 401);
    if (!env.CONNECT_KV) return json({ error: '服务尚未绑定 KV' }, 503);
    const id = api[1];
    if (!LINK_ID.test(id)) return json({ error: '入口 ID 格式不正确' }, 400);
    const key = `link:${id}`;
    if (request.method === 'GET') return json({ record: await env.CONNECT_KV.get(key, { type: 'json', cacheTtl: 30 }) });
    if (request.method !== 'PUT') return json({ error: '此接口支持 GET 和 PUT' }, 405, { Allow: 'GET, PUT' });
    try {
      const body = await smallJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求内容必须是 JSON 对象');
      const target = body.url === null ? null : validateTarget(body.url, {
        allowHttp: env.ALLOW_HTTP === 'true', allowedHosts: env.ALLOWED_HOSTS ?? ''
      });
      const lease = body.leaseSeconds ?? 1800;
      if (!Number.isInteger(lease) || (lease !== 0 && (lease < 60 || lease > 86400))) throw new Error('有效期应为 60–86400 秒，或 0（持续有效）');
      const label = String(body.label ?? '我的入口').trim().slice(0, 100);
      const record = { url: target, label, updatedAt: now(), expiresAt: target && lease > 0 ? now() + lease * 1000 : null };
      await env.CONNECT_KV.put(key, JSON.stringify(record));
      return json({ ok: true, updatedAt: record.updatedAt, expiresAt: record.expiresAt });
    } catch (error) {
      return json({ error: error.message || '更新失败' }, 400);
    }
  }
  const entry = url.pathname.match(/^\/r\/([A-Za-z0-9_-]+)$/);
  if (entry && LINK_ID.test(entry[1])) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: '请用浏览器打开入口' }, 405, { Allow: 'GET, HEAD' });
    if (!env.CONNECT_KV) return page('入口尚未配置', '请先完成 Connect 的云端部署。', { status: 503, head: request.method === 'HEAD' });
    let record;
    try { record = await env.CONNECT_KV.get(`link:${entry[1]}`, { type: 'json', cacheTtl: 30 }); }
    catch { return page('入口暂时无法读取', '请稍后重试。', { retry: true, status: 503, head: request.method === 'HEAD' }); }
    if (!record?.url || (record.expiresAt && record.expiresAt <= now())) {
      return page(record?.label ? `${record.label} 暂未上线` : '正在等待电脑上线', '请在电脑上开启隧道，并保持 Connect 同步运行。刚更新地址时，KV 传播可能需要约 60 秒或更久。', { retry: true, status: 503, head: request.method === 'HEAD' });
    }
    try {
      const target = validateTarget(record.url, { allowHttp: env.ALLOW_HTTP === 'true', allowedHosts: env.ALLOWED_HOSTS ?? '' });
      return new Response(null, { status: 302, headers: { ...HEADERS, Location: target } });
    } catch { return page('目标地址无效', '请在电脑上的 Connect 中重新配置地址来源。', { status: 503, head: request.method === 'HEAD' }); }
  }
  return page('入口不存在', '请检查链接是否完整。', { status: 404, head: request.method === 'HEAD' });
}

export default { async fetch(request, env) { try { return await handleRequest(request, env); } catch { return json({ error: '入口服务暂时不可用，请稍后重试' }, 503); } } };
