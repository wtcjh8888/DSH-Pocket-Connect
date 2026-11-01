#!/usr/bin/env node
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import QRCode from 'qrcode';
import { ROOT, DATA, readConfig, saveConfig, newProfile, publicConfig } from '../lib/config.mjs';
import { VERSION, entryUrl, publicUrl } from '../lib/shared.mjs';
import { createSource } from '../lib/sources.mjs';
import { AgentManager, Publisher } from '../lib/agent.mjs';
import { createUiServer, openBrowser } from '../lib/ui-server.mjs';
import { login, deploy, whoami } from '../lib/cloudflare.mjs';
import { timedFetch } from '../lib/network.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'ui';
const flag = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

function help() {
  console.log(`DSH Pocket Connect ${VERSION} — 随机地址，固定入口。

用法：node bin/connect.mjs <命令>

  ui / 无参数       打开本机快速配置面板
  init              生成当前安装独有的配置；已有配置保持不变
  setup             命令行快速配置向导
  login             登录 Cloudflare（浏览器授权）
  deploy            创建 KV 并部署 Worker
  sync              持续同步所有入口，Ctrl+C 停止并标记离线
  test [--id ID]    测试读取当前公网地址
  push <URL>        手动发布地址（--id ID 指定入口）
  offline           手动将入口标记离线（--id ID 指定入口）
  status            查看配置摘要和固定入口（不会显示更新密钥）
  qr [--id ID]      导出固定二维码到 data/qr/
  help              显示帮助

ui 参数：--no-open 不打开浏览器；--port 4178 自定义本机面板端口。
多台电脑共用服务：复制 Worker URL、对应入口 ID 和更新密钥到私有配置。
环境变量：CONNECT_DATA_DIR、CONNECT_UPDATE_TOKEN、DSH_HOME。
配置文件：${resolve(DATA, 'config.json')}`);
}

async function existingUi() {
  try {
    const instance = JSON.parse(await readFile(join(DATA, 'instance.json'), 'utf8'));
    if (!Number.isInteger(instance.port) || instance.port < 1 || instance.port > 65535 || typeof instance.token !== 'string') return null;
    const response = await timedFetch(`http://127.0.0.1:${instance.port}/api/state`, { headers: { 'X-Connect-Token': instance.token }, redirect: 'error' }, 1500);
    const value = await response.json();
    if (value.app !== 'connect-fixed-entry') return null;
    return `http://127.0.0.1:${instance.port}/#${instance.token}`;
  } catch { return null; }
}

async function showPanel(url) {
  log(`配置面板：${url}`);
  try { await openBrowser(url); return true; }
  catch (error) {
    console.error(`无法自动打开浏览器：${error.message}`);
    console.error('请复制上面的完整配置面板链接，粘贴到浏览器地址栏打开。');
    return false;
  }
}

async function ui() {
  const existing = await existingUi();
  if (existing) {
    log('Connect 已在运行，正在打开现有面板。');
    if (!args.includes('--no-open') && !await showPanel(existing)) process.exitCode = 1;
    return;
  }
  let app;
  const wanted = Number(flag('port', 4178));
  if (!Number.isInteger(wanted) || wanted < 1024 || wanted > 65525) throw new Error('面板端口应为 1024–65525');
  for (let port = wanted; port < wanted + 10; port++) {
    try { app = await createUiServer({ port }); break; }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  if (!app) throw new Error('本机面板端口被占用，请使用 --port 其他端口');
  log(`本机面板已启动：http://127.0.0.1:${app.server.address().port}`);
  log('保持此窗口运行即可自动同步；再次双击快速开始会打开同一个面板。');
  if (!args.includes('--no-open')) await showPanel(app.url);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; log('正在停止同步……'); await app.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

function profileFor(config) {
  const id = flag('id', config.profiles[0]?.id);
  const profile = config.profiles.find(item => item.id === id);
  if (!profile) throw new Error('没有找到入口；请先在面板中配置，或用 --id 指定已有入口 ID');
  return profile;
}

async function setup() {
  if (!stdin.isTTY) throw new Error('命令行向导需要交互终端；请双击快速开始.cmd 使用浏览器面板');
  const config = await readConfig();
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (question, value = '') => (await rl.question(`${question}${value ? ` [${value}]` : ''}：`)).trim() || value;
  try {
    console.log('\nDSH Pocket Connect 快速配置：只需部署一次，二维码保持固定。\n');
    config.gateway.workerName = await ask('Worker 服务名称', config.gateway.workerName);
    const account = await whoami();
    if (!account.loggedIn) await login(log);
    config.gateway.accountId = await ask('Account ID（只有一个账户可直接回车）', config.gateway.accountId);
    const p = config.profiles[0] || newProfile();
    p.name = await ask('入口名称', p.name);
    console.log('来源：1 DSH Pocket（默认）  2 JSON 接口  3 日志文件  4 手动 URL');
    const choice = await ask('选择来源', '1');
    if (choice === '1') p.source = { type: 'dsh-pocket', baseUrl: await ask('DSH Pocket 本机代理地址', 'http://127.0.0.1:3081'), homeDir: await ask('DSH_HOME（自动使用默认目录）') };
    else if (choice === '2') p.source = { type: 'json', endpoint: await ask('JSON 接口 URL'), path: await ask('URL 字段路径', 'url') };
    else if (choice === '3') p.source = { type: 'file', file: await ask('日志文件完整路径'), pattern: await ask('URL 正则（回车匹配 trycloudflare）') };
    else if (choice === '4') p.source = { type: 'manual', url: await ask('当前公网 URL') };
    else throw new Error('请选择 1–4');
    if (!config.profiles.length) config.profiles.push(p); else config.profiles[0] = p;
    config.autoStart = true;
    await saveConfig(config);
    await deploy(config, { log });
    console.log(`\n固定入口：${entryUrl(config.gateway.url, p.id)}\n`);
    console.log('配置完成。接下来打开本机面板并自动同步。');
  } finally { rl.close(); }
  await ui();
}

async function main() {
  if (['help', '--help', '-h'].includes(command)) return help();
  if (['--version', '-v'].includes(command)) return console.log(VERSION);
  if (command === 'ui') return ui();
  if (command === 'setup') return setup();
  if (command === 'login') return login(log);
  const config = await readConfig();
  if (command === 'init') return console.log(`配置已就绪：${resolve(DATA, 'config.json')}\n入口 ID：${config.profiles[0]?.id || '尚无入口'}\n更新密钥已保存在本机，不会输出。已有配置和入口 ID 保持不变。`);
  if (command === 'deploy') return deploy(config, { log });
  if (command === 'status') return console.log(JSON.stringify(publicConfig(config), null, 2));
  if (command === 'sync') {
    const manager = new AgentManager(() => config, log);
    for (const p of config.profiles) manager.start(p.id);
    log('自动同步已启动。Ctrl+C 停止。');
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await manager.stopAll(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  const profile = profileFor(config);
  if (command === 'test') { const result = await createSource(profile.source).read(); return console.log(result.url ? `读取成功：${publicUrl(result.url)}` : result.note); }
  if (command === 'push') {
    const url = args[1];
    if (!url || url.startsWith('--')) throw new Error('请提供需要发布的 HTTPS URL');
    await new Publisher(config.gateway).publish({ ...profile, source: { type: 'manual' } }, url);
    return console.log(`已更新：${entryUrl(config.gateway.url, profile.id)}`);
  }
  if (command === 'offline') { await new Publisher(config.gateway).publish(profile, null); return console.log('入口已标记离线。'); }
  if (command === 'qr') {
    const url = entryUrl(config.gateway.url, profile.id);
    if (!url) throw new Error('请先部署入口服务');
    await mkdir(join(DATA, 'qr'), { recursive: true });
    const path = join(DATA, 'qr', `connect-${profile.id}.png`);
    await QRCode.toFile(path, url, { width: 720, margin: 3, errorCorrectionLevel: 'M' });
    return console.log(`二维码已保存：${path}`);
  }
  throw new Error(`未知命令：${command}。使用 help 查看用法。`);
}

main().catch(error => { console.error(`\nConnect：${error.message}`); process.exitCode = 1; });
