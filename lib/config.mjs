import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINK_ID, entryUrl, validateTarget } from './shared.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = resolve(process.env.CONNECT_DATA_DIR || resolve(ROOT, 'data'));
export const CONFIG_PATH = resolve(DATA, 'config.json');
export const newId = () => randomBytes(18).toString('base64url');

export function newProfile(name = 'DSH Pocket') {
  return {
    id: newId(), name, intervalSeconds: 10, heartbeatSeconds: 900,
    leaseSeconds: 1800, offlineGraceSeconds: 30,
    source: { type: 'dsh-pocket', baseUrl: 'http://127.0.0.1:3081', homeDir: '' }
  };
}

export function defaults() {
  return {
    version: 1,
    gateway: { workerName: `dsh-pocket-connect-${randomBytes(3).toString('hex')}`, accountId: '', namespaceId: '', url: '', updateToken: randomBytes(32).toString('base64url') },
    autoStart: false, profiles: [newProfile()]
  };
}

export function validateConfig(config) {
  if (!config || config.version !== 1 || !config.gateway) throw new Error('配置文件版本无效');
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(config.gateway.workerName)) throw new Error('Worker 名称应为 3–61 位小写字母、数字或连字符，且以字母开头');
  if (config.gateway.accountId && !/^[a-f0-9]{32}$/i.test(config.gateway.accountId)) throw new Error('Cloudflare Account ID 应为 32 位十六进制字符');
  if (config.gateway.namespaceId && !/^[a-f0-9]{32}$/i.test(config.gateway.namespaceId)) throw new Error('KV ID 格式不正确');
  if (typeof config.gateway.updateToken !== 'string' || config.gateway.updateToken.length < 32 || config.gateway.updateToken.length > 256) throw new Error('更新密钥应为 32–256 字符');
  if (config.gateway.url) {
    const value = new URL(config.gateway.url);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname);
    if (value.protocol !== 'https:' && !(local && value.protocol === 'http:')) throw new Error('入口服务必须使用 HTTPS；本地调试可使用 HTTP');
    if (value.username || value.password || value.pathname !== '/' || value.search || value.hash) throw new Error('入口服务地址只需填写域名，不要包含路径、参数或密码');
    config.gateway.url = value.origin;
  }
  if (!Array.isArray(config.profiles) || config.profiles.length > 20) throw new Error('入口数量应在 0–20 之间');
  const ids = new Set();
  for (const p of config.profiles) {
    if (!LINK_ID.test(p.id) || ids.has(p.id)) throw new Error('入口 ID 无效或重复');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100) throw new Error('入口名称应为 1–100 字符');
    for (const [key, low, high] of [['intervalSeconds', 3, 300], ['heartbeatSeconds', 60, 3600], ['leaseSeconds', 120, 86400], ['offlineGraceSeconds', 0, 300]]) {
      if (!Number.isInteger(p[key]) || p[key] < low || p[key] > high) throw new Error(`${key} 应为 ${low}–${high} 之间的整数`);
    }
    if (p.leaseSeconds < p.heartbeatSeconds * 2) throw new Error('有效期至少应为续期周期的两倍');
    const s = p.source;
    if (!s || !['dsh-pocket', 'json', 'file', 'manual'].includes(s.type)) throw new Error('请选择有效的地址来源');
    if (s.type === 'dsh-pocket') {
      const base = new URL(s.baseUrl);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('DSH 地址应为本机代理地址，例如 http://127.0.0.1:3081');
    }
    if (s.type === 'json') {
      const endpoint = new URL(s.endpoint);
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('JSON 接口地址无效');
      if (typeof s.path !== 'string' || s.path.length > 200) throw new Error('JSON 字段路径无效');
    }
    if (s.type === 'file') {
      if (typeof s.file !== 'string' || !s.file.trim()) throw new Error('请填写日志或文本文件路径');
      if (s.pattern) {
        if (typeof s.pattern !== 'string' || s.pattern.length > 500) throw new Error('正则表达式过长');
        new RegExp(s.pattern, 'g');
      }
    }
    if (s.type === 'manual' && s.url) validateTarget(s.url);
  }
  return config;
}

export async function readConfig(path = CONFIG_PATH) {
  try { return validateConfig(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`无法读取配置：${error.message}`);
    const config = defaults();
    await saveConfig(config, path);
    return config;
  }
}

export async function saveConfig(config, path = CONFIG_PATH) {
  validateConfig(config);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function publicConfig(config) {
  return {
    version: config.version, autoStart: config.autoStart,
    gateway: { ...config.gateway, updateToken: undefined, tokenConfigured: Boolean(config.gateway.updateToken) },
    profiles: config.profiles.map(p => ({ ...p, entryUrl: entryUrl(config.gateway.url, p.id) }))
  };
}
