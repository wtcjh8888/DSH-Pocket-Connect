export const VERSION = '1.0.0';
export const LINK_ID = /^[A-Za-z0-9_-]{16,80}$/;

export function validateTarget(value, { allowHttp = false, allowedHosts = '' } = {}) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('目标地址必须是有效的 URL（最多 4096 字符）');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('目标地址不是有效的 URL'); }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw new Error('目标地址必须使用 HTTPS');
  if (url.username || url.password) throw new Error('目标 URL 不能包含用户名或密码');
  const hosts = String(allowedHosts).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (hosts.length && !hosts.some(host => host.startsWith('*.')
    ? url.hostname.endsWith(host.slice(1)) && url.hostname !== host.slice(2)
    : url.hostname === host)) throw new Error('目标域名不在允许列表中');
  return url.toString();
}

export function entryUrl(gateway, id) {
  if (!LINK_ID.test(id)) throw new Error('入口 ID 格式不正确');
  if (!gateway) return '';
  const url = new URL(gateway);
  url.pathname = `/r/${id}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function publicUrl(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return ''; }
}

export function readJsonPath(value, path = 'url') {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (['__proto__', 'prototype', 'constructor'].includes(part)) throw new Error('JSON 字段路径无效');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}
