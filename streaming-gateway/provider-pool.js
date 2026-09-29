import { randomUUID } from 'node:crypto';
import { priorityMatrix } from './priority.js';

export class PoolError extends Error {
  constructor(code = 'pool_capacity', status = 503) { super(code); this.code = code; this.status = status; }
}

export const PROVIDER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

// One process owns the upstream accounts. Every media fetch must hold a current lease.
export class ProviderPool {
  constructor({ now = Date.now, idleMs = priorityMatrix.idleReleaseMs, viewerMs = priorityMatrix.viewerWindowMs, health = null } = {}) {
    this.health = health;
    this.now = now; this.idleMs = idleMs; this.viewerMs = viewerMs;
    this.demands = new Map(); this.leases = new Map(); this.blocked = new Map(); this.tails = new Map(); this.failures = Object.fromEntries(PROVIDER_IDS.map(id => [id, 0]));
    this.timer = setInterval(() => this.rebalance(), 1000); this.timer.unref();
  }
  close() { clearInterval(this.timer); this.health?.close(); for (const lease of this.leases.values()) lease.controller.abort(); }
  score(demand) { return demand.base + demand.viewers.size * priorityMatrix.viewerPoints; }
  valid(lease) { return this.leases.get(lease.provider) === lease && !lease.controller.signal.aborted; }
  touch(lease, viewer) {
    if (!this.valid(lease)) return false;
    const demand = this.demands.get(lease.key);
    if (!demand) return false;
    demand.lastSeen = this.now(); demand.viewers.set(viewer, this.now());
    return true;
  }
  revoke(provider) {
    const lease = this.leases.get(provider);
    lease?.controller.abort(); this.leases.delete(provider);
  }
  rebalance() {
    const now = this.now();
    for (const [key, demand] of this.demands) {
      for (const [viewer, at] of demand.viewers) if (now - at >= this.viewerMs) demand.viewers.delete(viewer);
      if (!demand.viewers.size || now - demand.lastSeen >= this.idleMs) this.demands.delete(key);
    }
    for (const [provider, lease] of this.leases) {
      const demand = this.demands.get(lease.key);
      if (!demand || (this.blocked.get(provider) || 0) > now
        || (demand.sources[provider] !== lease.url && !demand.viewers.size)) this.revoke(provider);
    }
    const protectedLeases = new Map([...this.leases.values()].flatMap(lease => {
      const demand = this.demands.get(lease.key);
      return demand?.viewers.size ? [[lease.provider, demand]] : [];
    }));
    const held = new Set([...this.leases.values()].map(lease => lease.key));
    const ranked = [...this.demands.values()].sort((a, b) => this.score(b) - this.score(a)
      || Number(held.has(b.key)) - Number(held.has(a.key)) || a.createdAt - b.createdAt || a.key.localeCompare(b.key));
    const desired = new Map(protectedLeases);
    for (const demand of ranked) {
      if ([...protectedLeases.values()].some(item => item.key === demand.key)) continue;
      const current = [...this.leases.values()].find(lease => lease.key === demand.key)?.provider;
      const available = [...PROVIDER_IDS].sort((a, b) => {
        const score = id => this.leases.has(id) ? this.score(this.demands.get(this.leases.get(id).key)) : -1;
        return score(a) - score(b);
      });
      const providers = [...new Set([current, ...available].filter(Boolean))];
      const provider = providers.find(id => !desired.has(id) && demand.sources[id] && (this.blocked.get(id) || 0) <= now
        && (!this.leases.has(id) || this.leases.get(id).key === demand.key)
        && (!(demand.failedUntil > now) || !this.leases.has(id) || this.leases.get(id).key === demand.key));
      if (provider) desired.set(provider, demand);
      if (desired.size === PROVIDER_IDS.length) break;
    }
    for (const [provider, lease] of this.leases) if (desired.get(provider)?.key !== lease.key) this.revoke(provider);
    for (const [provider, demand] of desired) if (!this.leases.has(provider)) {
      this.leases.set(provider, { id: randomUUID(), provider, key: demand.key, url: demand.sources[provider],
        controller: new AbortController(), tail: Promise.resolve() });
    }
  }
  acquire(playback, viewer) {
    const now = this.now();
    // A diagnostic screen and a match viewer share one upstream for the same channel.
    const shared = playback.channel_id && [...this.demands.values()].find(item => item.channel === playback.channel_id);
    const key = shared?.key || playback.pool_key || playback.match_id;
    let demand = this.demands.get(key);
    if (!demand) {
      demand = { key, viewers: new Map(), createdAt: now };
      this.demands.set(key, demand);
    }
    Object.assign(demand, { sources: playback.provider_sources || {}, base: Math.max(demand.base || 0, playback.priority_score || 10),
      channel: playback.channel_id, lastSeen: now });
    demand.viewers.set(viewer, now);
    this.rebalance();
    const lease = [...this.leases.values()].find(item => item.key === key);
    if (!lease) throw new PoolError();
    return lease;
  }
  quarantine(provider, until) {
    const lease = this.leases.get(provider);
    const demand = lease && this.demands.get(lease.key);
    if (demand) { demand.failedUntil = until; demand.failedProvider = provider; }
    this.blocked.set(provider, until);
    this.revoke(provider); this.rebalance();
  }
  fail(lease, status = 403) {
    if (!this.valid(lease)) return;
    this.failures[lease.provider]++;
    const until = this.health?.failure(lease.provider, status) ?? this.now() + 30000;
    this.quarantine(lease.provider, until);
  }
  failStalled(lease) {
    if (!this.valid(lease)) return;
    this.failures[lease.provider]++;
    const until = this.health?.stalled(lease.provider) ?? this.now() + 60000;
    this.quarantine(lease.provider, until);
  }
  updateSource(lease, sourceUrl) {
    if (!this.valid(lease) || typeof sourceUrl !== 'string' || !sourceUrl) return false;
    const demand = this.demands.get(lease.key);
    if (!demand || demand.sources[lease.provider] !== sourceUrl) return false;
    lease.url = sourceUrl;
    return true;
  }
  async run(lease, operation) {
    const task = (this.tails.get(lease.provider) || Promise.resolve()).catch(() => {}).then(async () => {
      if (!this.valid(lease)) throw new PoolError('pool_reassigned', 409);
      const result = await operation(lease.controller.signal);
      if (!this.valid(lease)) throw new PoolError('pool_reassigned', 409);
      return result;
    });
    this.tails.set(lease.provider, task.catch(() => {}));
    return task;
  }
  snapshot() {
    this.rebalance();
    return [...this.leases.values()].map(lease => {
      const demand = this.demands.get(lease.key);
      return { provider: lease.provider, channel: demand.channel, viewers: demand.viewers.size,
        base: demand.base, score: this.score(demand) };
    });
  }
}
