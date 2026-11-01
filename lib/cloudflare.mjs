import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ROOT, DATA, saveConfig, validateConfig } from './config.mjs';
import { timedFetch } from './network.mjs';

export const WRANGLER = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');
export const WRANGLER_CONFIG = join(DATA, 'wrangler.json');
const ansi = /\x1b\[[0-9;]*m/g;

export async function runWrangler(args, { log = () => {}, timeout = 180000, silent = false } = {}) {
  await mkdir(DATA, { recursive: true });
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT, windowsHide: true, shell: false,
      env: { ...process.env, XDG_CONFIG_HOME: join(DATA, 'xdg'), WRANGLER_LOG_PATH: join(DATA, 'wrangler.log'), WRANGLER_SEND_METRICS: 'false', CI: 'true', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    const collect = chunk => {
      const text = chunk.toString().replace(ansi, '');
      output = (output + text).slice(-2 * 1024 * 1024);
      if (!silent) for (const line of text.split(/\r?\n/).filter(Boolean)) log(line);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('Cloudflare 操作超时；请检查网络，登录时请完成浏览器授权'));
      if (code !== 0) return reject(new Error(output.trim().split('\n').slice(-10).join('\n') || `Wrangler 操作失败（${code}）`));
      resolveResult(output);
    });
  });
}

export function parseWhoami(output) {
  const lines = output.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    try {
      const value = JSON.parse(lines.slice(i).join('\n'));
      if (typeof value.loggedIn === 'boolean') return {
        loggedIn: value.loggedIn,
        accounts: Array.isArray(value.accounts) ? value.accounts.map(a => ({ id: a.id, name: a.name })) : []
      };
    } catch { /* Skip CLI notices before JSON. */ }
  }
  throw new Error('无法识别 Cloudflare 登录状态');
}

export async function whoami() {
  try { return parseWhoami(await runWrangler(['whoami', '--json'], { silent: true, timeout: 30000 })); }
  catch (error) {
    if (error.message.includes('"loggedIn":false')) return { loggedIn: false, accounts: [] };
    throw error;
  }
}

export async function login(log) {
  log('正在打开 Cloudflare 授权页，请在浏览器中登录并允许授权。');
  await runWrangler(['login'], { log, timeout: 300000 });
  const account = await whoami();
  if (!account.loggedIn) throw new Error('Cloudflare 登录尚未完成');
  log('Cloudflare 登录成功。');
  return account;
}

export async function writeWranglerConfig(config) {
  await mkdir(DATA, { recursive: true });
  const file = {
    name: config.gateway.workerName,
    main: resolve(ROOT, 'cloudflare/worker.mjs').replaceAll('\\', '/'),
    compatibility_date: '2026-10-01', workers_dev: true,
    ...(config.gateway.accountId ? { account_id: config.gateway.accountId } : {}),
    ...(config.gateway.namespaceId ? { kv_namespaces: [{ binding: 'CONNECT_KV', id: config.gateway.namespaceId }] } : {}),
    observability: { enabled: false }
  };
  await writeFile(WRANGLER_CONFIG, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export async function deploy(config, { log = () => {}, save = saveConfig } = {}) {
  validateConfig(config);
  const account = await whoami();
  if (!account.loggedIn) throw new Error('请先点击“登录 Cloudflare”，完成浏览器授权');
  const accounts = account.accounts || [];
  if (!config.gateway.accountId && accounts.length === 1) config.gateway.accountId = accounts[0].id;
  if (!config.gateway.accountId && accounts.length > 1) throw new Error('你的账号包含多个 Cloudflare 账户，请在高级设置中填写目标 Account ID');
  await writeWranglerConfig(config);
  if (!config.gateway.namespaceId) {
    log('正在创建用于保存隧道地址的 KV 空间……');
    // Wrangler writes the exact namespace ID into the generated config; no output parsing.
    await runWrangler(['kv', 'namespace', 'create', `${config.gateway.workerName}-links`, '--binding', 'CONNECT_KV', '--update-config', '--config', WRANGLER_CONFIG], { log });
    const created = JSON.parse(await readFile(WRANGLER_CONFIG, 'utf8'));
    const id = created.kv_namespaces?.find(binding => binding.binding === 'CONNECT_KV')?.id;
    if (!/^[a-f0-9]{32}$/i.test(id || '')) throw new Error('KV 已创建，但未能读取绑定 ID；请在 Cloudflare 面板查看后填入高级配置，避免重复创建');
    config.gateway.namespaceId = id;
    await save(config);
  }
  await writeWranglerConfig(config);
  const secretsPath = join(DATA, 'deploy-secrets.json');
  let output;
  try {
    await writeFile(secretsPath, JSON.stringify({ UPDATE_TOKEN: process.env.CONNECT_UPDATE_TOKEN || config.gateway.updateToken }), { mode: 0o600 });
    log('正在部署入口服务和更新密钥……');
    output = await runWrangler(['deploy', '--config', WRANGLER_CONFIG, '--secrets-file', secretsPath], { log });
  } finally { await rm(secretsPath, { force: true }); }
  const urls = output.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev\b/g) || [];
  const expected = urls.find(url => new URL(url).hostname.startsWith(`${config.gateway.workerName}.`));
  if (!expected && !config.gateway.url) throw new Error('Worker 已部署，但未识别入口 URL。请从 Cloudflare 面板复制 workers.dev 地址，填入“连接已有服务”');
  config.gateway.url = expected || config.gateway.url;
  await save(config);
  log(`固定入口服务已部署：${config.gateway.url}`);
  try {
    const response = await timedFetch(new URL('/health', config.gateway.url), { redirect: 'error' }, 10000);
    const health = await response.json();
    if (!response.ok || health.app !== 'connect-fixed-entry' || !health.ready) throw new Error('服务尚未就绪');
    log('入口服务检查通过。');
  } catch { log('部署已完成，当前网络暂未验证公网可达性。请稍后用手机访问固定入口。'); }
  return config.gateway.url;
}
