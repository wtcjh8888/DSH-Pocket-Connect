import { timedFetch, limitedText } from './network.mjs';
import { entryUrl, publicUrl } from './shared.mjs';
import { createSource } from './sources.mjs';

const OFFLINE_RETRY_MS = 60000;

export class Publisher {
  constructor(gateway, fetcher = timedFetch) { this.gateway = gateway; this.fetcher = fetcher; }
  async publish(profile, url, { signal } = {}) {
    if (!this.gateway.url) throw new Error('请先部署或连接入口服务');
    const endpoint = new URL(`/api/links/${profile.id}`, this.gateway.url);
    const response = await this.fetcher(endpoint, {
      method: 'PUT', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CONNECT_UPDATE_TOKEN || this.gateway.updateToken}` },
      body: JSON.stringify({ url, label: profile.name, leaseSeconds: profile.source.type === 'manual' ? 0 : profile.leaseSeconds })
    }, 10000);
    let result;
    try { result = JSON.parse(await limitedText(response, 65536)); } catch { throw new Error(`入口服务返回了无效响应（${response.status}）`); }
    if (!response.ok || !result.ok) throw new Error(result.error || `入口更新失败（${response.status}）`);
    return result;
  }
}

export class SyncAgent {
  constructor(profile, gateway, { source, publisher, now = Date.now, onChange = () => {}, log = () => {} } = {}) {
    this.profile = profile;
    this.gateway = gateway;
    this.source = source || createSource(profile.source);
    this.publisher = publisher || new Publisher(gateway);
    this.now = now;
    this.onChange = onChange;
    this.log = log;
    this.lastPublishedUrl = undefined;
    this.lastPublishedAt = 0;
    this.lastOfflinePushAt = 0;
    this.unavailableSince = null;
    this.status = { running: false, state: 'stopped', note: '未启动', checkedAt: null, publishedAt: null, target: '' };
    this.timer = null;
    this.ticking = null;
  }
  update(patch) { Object.assign(this.status, patch); this.onChange(this.status); }
  async tick() {
    let result;
    try { result = await this.source.read(); }
    catch (error) { result = { url: null, note: this.friendlyError(error) }; }
    this.update({ checkedAt: this.now() });
    if (!result.url) {
      this.unavailableSince ??= this.now();
      const waiting = this.now() - this.unavailableSince < this.profile.offlineGraceSeconds * 1000;
      this.update({ state: waiting && this.lastPublishedUrl ? 'reconnecting' : 'waiting', note: result.note || '等待隧道地址' });
      // Failed uploads leave the marker pending; retry at most once per minute.
      if (!waiting && this.lastPublishedUrl !== null && this.now() - this.lastOfflinePushAt >= OFFLINE_RETRY_MS) {
        this.lastOfflinePushAt = this.now();
        await this.push(null);
      }
      return;
    }
    this.unavailableSince = null;
    const changed = result.url !== this.lastPublishedUrl;
    const renewal = this.profile.source.type !== 'manual' && this.now() - this.lastPublishedAt >= this.profile.heartbeatSeconds * 1000;
    if (changed || renewal) await this.push(result.url);
    this.update({ state: 'online', note: '已同步，入口会跳转到最新地址', target: publicUrl(result.url) });
  }
  friendlyError(error, { subject = '读取地址', unavailable = '等待本机服务启动；请检查代理端口' } = {}) {
    if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') return unavailable;
    if (error?.name === 'TimeoutError') return `${subject}超时，正在重试`;
    return String(error?.message || `${subject}失败`).replace(/([?&](?:token|key|password)=)[^&\s]+/gi, '$1***');
  }
  async push(url) {
    await this.publisher.publish(this.profile, url);
    this.lastPublishedUrl = url;
    this.lastPublishedAt = this.now();
    this.update({ publishedAt: this.now(), target: url ? publicUrl(url) : '' });
    this.log(`${this.profile.name}：${url ? '已更新固定入口' : '已标记离线'}`);
  }
  start() {
    if (this.status.running) return;
    this.update({ running: true, state: 'checking', note: '正在读取地址' });
    const publishOptions = { subject: '发布到固定入口', unavailable: '无法连接固定入口；请检查电脑网络或代理设置' };
    const loop = async () => {
      if (!this.status.running) return;
      this.ticking = this.tick().catch(error => this.update({ state: 'error', note: this.friendlyError(error, publishOptions) }));
      await this.ticking;
      this.ticking = null;
      if (this.status.running) this.timer = setTimeout(loop, this.profile.intervalSeconds * 1000);
    };
    void loop();
  }
  async stop({ offline = true } = {}) {
    this.update({ running: false });
    clearTimeout(this.timer);
    if (this.ticking) await this.ticking;
    if (offline && this.lastPublishedUrl !== undefined && this.lastPublishedUrl !== null) {
      try { await this.push(null); } catch (error) { this.log(`${this.profile.name}：离线标记未送达，将在有效期结束后自动失效（${this.friendlyError(error, { subject: '标记离线', unavailable: '无法连接固定入口' })}）`); }
    }
    this.update({ state: 'stopped', note: '同步已停止' });
  }
  snapshot() { return { ...this.status, entryUrl: entryUrl(this.gateway.url, this.profile.id) }; }
}

export class AgentManager {
  constructor(getConfig, log = () => {}) { this.getConfig = getConfig; this.log = log; this.agents = new Map(); }
  start(id) {
    const config = this.getConfig();
    if (!config.gateway.url) throw new Error('请先部署或连接入口服务');
    const profile = config.profiles.find(p => p.id === id);
    if (!profile) throw new Error('入口不存在');
    if (this.agents.get(id)?.status.running) return;
    const agent = new SyncAgent(profile, config.gateway, { log: this.log });
    this.agents.set(id, agent);
    agent.start();
  }
  async stop(id, options) { await this.agents.get(id)?.stop(options); }
  async stopAll(options) { await Promise.all([...this.agents.values()].map(agent => agent.stop(options))); }
  snapshots() { return Object.fromEntries([...this.agents].map(([id, agent]) => [id, agent.snapshot()])); }
}
