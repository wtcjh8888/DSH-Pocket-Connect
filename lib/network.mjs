export async function timedFetch(url, options = {}, timeout = 6000) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  return fetch(url, { ...options, signal });
}

export async function limitedText(response, limit = 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('响应内容过大'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks, length).toString('utf8');
}

export class CookieSession {
  constructor(base, fetcher = timedFetch) {
    this.base = new URL(base).origin;
    this.cookies = new Map();
    this.fetcher = fetcher;
  }
  clear() { this.cookies.clear(); }
  async request(path, options = {}) {
    let url = new URL(path, this.base);
    let method = options.method || 'GET';
    let body = options.body;
    for (let i = 0; i < 8; i++) {
      if (url.origin !== this.base) throw new Error('本机认证接口重定向到其他站点，已停止发送认证信息');
      const headers = new Headers(options.headers || {});
      if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
      const response = await this.fetcher(url, { ...options, method, body, headers, redirect: 'manual' });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair, ...attributes] = cookie.split(';');
        const at = pair.indexOf('=');
        if (at < 1) continue;
        const name = pair.slice(0, at).trim(), value = pair.slice(at + 1);
        if (!value || attributes.some(a => /^\s*max-age=0\s*$/i.test(a))) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) return response;
      const next = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      if (next.origin !== this.base) throw new Error('本机认证接口重定向到其他站点，已停止发送认证信息');
      url = next;
      if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) { method = 'GET'; body = undefined; }
    }
    throw new Error('本机认证重定向次数过多，请确认 DSH Pocket 已更新');
  }
}
