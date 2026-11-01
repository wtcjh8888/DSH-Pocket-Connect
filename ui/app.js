const $ = id => document.getElementById(id);
let token = location.hash.slice(1) || sessionStorage.getItem('connect-token') || '';
if (token) sessionStorage.setItem('connect-token', token);
history.replaceState(null, '', location.pathname);
let state, selectedId = '', currentQr = '', qrKey = '', lastLogs = '', working = false, initial = true;

async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Connect-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `请求失败（${response.status}）`);
  return value;
}
function show(message, error = false) { $('banner').textContent = message; $('banner').classList.toggle('error', error); $('banner').classList.remove('hidden'); }
function hideBanner() { $('banner').classList.add('hidden'); }
async function action(fn) {
  if (working) return;
  working = true;
  document.body.classList.add('working');
  try { await fn(); await refresh(); } catch (error) { show(error.message, true); }
  finally { working = false; document.body.classList.remove('working'); }
}
function fillGateway() {
  const g = state.config.gateway;
  $('worker-name').value = g.workerName;
  $('gateway-url').value = g.url;
  $('account-id').value = g.accountId;
  $('namespace-id').value = g.namespaceId;
  $('auto-start').checked = state.config.autoStart;
}
function sourceTypeChanged() { for (const element of document.querySelectorAll('.source-fields')) element.classList.toggle('hidden', element.id !== `source-${$('source-type').value}`); }
function fillProfile() {
  const profile = state.config.profiles.find(p => p.id === selectedId);
  const p = profile || { name: '', intervalSeconds: 10, heartbeatSeconds: 900, leaseSeconds: 1800, offlineGraceSeconds: 30, source: { type: 'dsh-pocket', baseUrl: 'http://127.0.0.1:3081' } };
  $('profile-name').value = p.name;
  $('source-type').value = p.source.type;
  $('dsh-base').value = p.source.baseUrl || 'http://127.0.0.1:3081';
  $('dsh-home').value = p.source.homeDir || '';
  $('json-endpoint').value = p.source.endpoint || '';
  $('json-path').value = p.source.path || '';
  $('log-file').value = p.source.file || '';
  $('log-pattern').value = p.source.pattern || '';
  $('manual-url').value = p.source.url || '';
  $('poll').value = p.intervalSeconds;
  $('heartbeat').value = p.heartbeatSeconds;
  $('lease').value = p.leaseSeconds;
  $('grace').value = p.offlineGraceSeconds;
  $('source-result').classList.add('hidden');
  sourceTypeChanged();
}
function readSource() {
  const type = $('source-type').value;
  if (type === 'dsh-pocket') return { type, baseUrl: $('dsh-base').value.trim(), homeDir: $('dsh-home').value.trim() };
  if (type === 'json') return { type, endpoint: $('json-endpoint').value.trim(), path: $('json-path').value.trim() || 'url' };
  if (type === 'file') return { type, file: $('log-file').value.trim(), pattern: $('log-pattern').value.trim() };
  return { type, url: $('manual-url').value.trim() };
}
function updateSelect() {
  const key = JSON.stringify(state.config.profiles.map(p => [p.id, p.name]));
  if ($('profile-select').dataset.key === key) return;
  $('profile-select').dataset.key = key;
  $('profile-select').replaceChildren();
  for (const profile of state.config.profiles) {
    const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; $('profile-select').append(option);
  }
  const add = document.createElement('option'); add.value = ''; add.textContent = '+ 新增入口'; $('profile-select').append(add);
  if (initial) selectedId = state.config.profiles[0]?.id || '';
  $('profile-select').value = selectedId;
}
async function renderEntry() {
  const p = state.config.profiles.find(profile => profile.id === selectedId);
  const agent = state.agents[selectedId];
  const url = p?.entryUrl || '';
  $('entry-title').textContent = p?.name || '你的固定入口';
  $('entry-link').textContent = url || (state.config.gateway.url ? '保存来源后生成固定入口链接' : '完成部署后显示入口链接');
  $('qr-empty-note').textContent = state.config.gateway.url ? '保存来源后生成固定二维码' : '部署后生成固定二维码';
  $('copy-link').disabled = !url;
  $('download-qr').disabled = !url;
  $('toggle-sync').disabled = !url || !p || state.operation.busy;
  $('toggle-sync').textContent = agent?.running ? '停止同步' : '开始同步 →';
  $('sync-title').textContent = agent?.running ? (agent.state === 'online' ? '正在自动同步' : '同步运行中') : '同步尚未启动';
  $('sync-note').textContent = agent?.note || (url ? '开启同步后，新地址会自动更新到固定入口。' : '先完成左侧配置，再开启地址同步。');
  $('sync-dot').classList.toggle('muted', agent?.state !== 'online');
  const badge = $('entry-status');
  badge.textContent = !url ? (state.config.gateway.url ? '等待保存' : '等待部署') : agent?.state === 'online' ? '已同步' : agent?.running ? '等待地址' : '入口已就绪';
  badge.className = `badge ${agent?.state === 'online' ? 'ok' : agent?.running ? 'warn' : ''}`;
  const key = `${url}:${selectedId}`;
  if (key !== qrKey) {
    qrKey = key;
    if (!url) { currentQr = ''; $('qr-image').classList.add('hidden'); $('qr-empty').classList.remove('hidden'); }
    else {
      const response = await fetch(`/api/qr?id=${encodeURIComponent(selectedId)}`, { headers: { 'X-Connect-Token': token } });
      if (!response.ok) { qrKey = ''; throw new Error('二维码生成失败'); }
      const svg = await response.text();
      if (key !== qrKey) return;
      currentQr = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      $('qr-image').src = currentQr; $('qr-image').classList.remove('hidden'); $('qr-empty').classList.add('hidden');
    }
  }
}
async function refresh() {
  const previousGateway = state ? JSON.stringify(state.config.gateway) : '';
  state = await api('state');
  $('version').textContent = `v${state.version}`;
  $('profile-count').textContent = state.config.profiles.length;
  updateSelect();
  if (initial) { fillGateway(); fillProfile(); }
  else if (previousGateway !== JSON.stringify(state.config.gateway)) fillGateway();
  $('cloud-status').textContent = state.config.gateway.url ? '已部署' : state.account.loggedIn ? '已登录' : '未登录';
  $('cloud-status').className = `badge ${state.config.gateway.url || state.account.loggedIn ? 'ok' : ''}`;
  $('cloud-login').disabled = state.operation.busy;
  $('deploy').disabled = state.operation.busy;
  $('operation').classList.toggle('hidden', !state.operation.busy);
  $('operation-text').textContent = state.operation.title;
  $('activity-state').textContent = state.operation.busy ? state.operation.title : '本机运行中';
  if (state.operation.error && $('banner').dataset.operationError !== state.operation.error) { show(state.operation.error, true); $('banner').dataset.operationError = state.operation.error; }
  const logsKey = JSON.stringify(state.logs);
  if (lastLogs !== logsKey) {
    lastLogs = logsKey;
    if (state.logs.length) {
      $('logs').replaceChildren();
      for (const log of state.logs.slice(-35).reverse()) {
        const line = document.createElement('div'); line.className = 'log-line';
        const time = document.createElement('span'); time.className = 'log-time'; time.textContent = new Date(log.at).toLocaleTimeString();
        const text = document.createElement('span'); text.textContent = log.message;
        line.append(time, text); $('logs').append(line);
      }
    }
  }
  await renderEntry();
  initial = false;
}
async function saveGateway() {
  const button = $('save-gateway');
  const result = $('gateway-save-status');
  button.disabled = true;
  button.textContent = '正在保存…';
  result.classList.remove('hidden', 'error');
  result.textContent = '正在保存配置…';
  try {
    const saved = await api('config', { gateway: { workerName: $('worker-name').value.trim(), url: $('gateway-url').value.trim(), updateToken: $('update-token').value.trim(), accountId: $('account-id').value.trim(), namespaceId: $('namespace-id').value.trim() }, autoStart: $('auto-start').checked });
    $('update-token').value = '';
    const enabled = saved.autoStart ?? $('auto-start').checked;
    result.textContent = `已保存 ✓ · 自动同步${enabled ? '已开启' : '已关闭'}`;
    return saved;
  } catch (error) {
    result.classList.add('error');
    result.textContent = `保存失败：${error.message}`;
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = '保存服务配置';
  }
}
$('source-type').addEventListener('change', sourceTypeChanged);
$('profile-select').addEventListener('change', () => { selectedId = $('profile-select').value; fillProfile(); void renderEntry(); });
$('cloud-login').addEventListener('click', () => action(async () => { hideBanner(); await api('login', {}); }));
$('deploy').addEventListener('click', () => action(async () => { hideBanner(); await saveGateway(); await api('deploy', {}); }));
$('save-gateway').addEventListener('click', () => action(async () => { await saveGateway(); show('服务配置已保存。'); }));
$('test-source').addEventListener('click', () => action(async () => {
  const output = $('source-result'); output.classList.remove('hidden', 'error'); output.textContent = '正在读取地址……';
  try { const result = await api('test', { source: readSource() }); output.textContent = result.url ? `读取成功：${result.url}` : (result.note || '当前没有可用公网地址，请先开启隧道。'); }
  catch (error) { output.classList.add('error'); output.textContent = error.message; }
}));
$('save-profile').addEventListener('click', () => action(async () => {
  const result = await api('profile', { ...(selectedId ? { id: selectedId } : {}), name: $('profile-name').value.trim(), source: readSource(), intervalSeconds: Number($('poll').value), heartbeatSeconds: Number($('heartbeat').value), leaseSeconds: Number($('lease').value), offlineGraceSeconds: Number($('grace').value) });
  selectedId = result.id;
  show('来源已保存。点击右侧“开始同步”，并保持电脑端 Connect 运行。');
}));
$('toggle-sync').addEventListener('click', () => action(async () => { hideBanner(); await api(state.agents[selectedId]?.running ? 'stop' : 'start', { id: selectedId }); }));
$('copy-link').addEventListener('click', () => action(async () => { await navigator.clipboard.writeText(state.config.profiles.find(p => p.id === selectedId).entryUrl); show('固定入口链接已复制。请收藏此链接。'); }));
$('download-qr').addEventListener('click', () => { if (!currentQr) return; const link = document.createElement('a'); link.href = currentQr; link.download = `connect-${selectedId}.svg`; link.click(); });
$('shutdown').addEventListener('click', () => action(async () => { await api('shutdown', {}); show('Connect 已退出。再次双击“快速开始.cmd”即可打开。'); }));
void refresh().then(() => api('check-cloud', {})).catch(error => show(error.message, true));
setInterval(() => { if (!working) void refresh().catch(error => { if (!state) show(error.message, true); }); }, 2000);
