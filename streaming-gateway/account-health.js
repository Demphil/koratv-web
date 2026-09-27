import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { PROVIDER_IDS } from './provider-pool.js';

export class AccountHealth {
  constructor({ accounts, path, fetchImpl = fetch, now = Date.now }) {
    this.accounts = accounts; this.path = path; this.fetch = fetchImpl; this.now = now;
    this.states = new Map(); this.checking = false; this.closed = false;
    try {
      for (const row of JSON.parse(readFileSync(path, 'utf8')).accounts || []) {
        this.states.set(row.provider, { code: row.last_http_code, checked: row.last_checked_at,
          reason: row.stopped_reason, stopped: row.status === 'STOPPED_EXPIRED',
          until: Date.parse(row.cooldown_until) || 0, failures: row.consecutive_403 || 0 });
      }
    } catch {}
  }
  state(id) {
    if (!this.states.has(id)) this.states.set(id, { code: null, checked: null, reason: null, stopped: false, until: 0, failures: 0 });
    return this.states.get(id);
  }
  attach(pool) {
    this.pool = pool;
    for (const id of PROVIDER_IDS) {
      const state = this.state(id);
      if (state.stopped || state.until > this.now()) pool.blocked.set(id, state.stopped ? Infinity : state.until);
    }
    this.writer = setInterval(() => this.persist(), 1000); this.writer.unref();
    this.checker = setInterval(() => void this.check(), 60000); this.checker.unref();
    this.persist(); void this.check();
  }
  close() { this.closed = true; clearInterval(this.writer); clearInterval(this.checker); this.persist(); }
  observe(id, code, media = true) {
    const state = this.state(id);
    state.code = code; state.checked = new Date(this.now()).toISOString();
    if (code === 200 && media) { state.reason = null; state.failures = 0; state.stopped = false; state.until = 0; }
  }
  failure(id, code) {
    this.observe(id, code);
    const state = this.state(id);
    state.failures += code === 403 ? 1 : 0;
    state.stopped = code === 401;
    state.reason = code === 401 ? 'upstream_authentication_401' : state.failures >= 3 ? 'persistent_upstream_403' : 'upstream_403';
    state.until = this.now() + (state.failures >= 3 ? 300000 : 30000);
    this.persist();
    return state.stopped ? Infinity : state.until;
  }
  async check() {
    if (this.checking || this.closed) return;
    this.checking = true;
    try {
      for (const [id, account] of Object.entries(this.accounts())) {
        if (this.closed) break;
        if (!PROVIDER_IDS.includes(id) || !account.enabled || !account.sourceUrl) continue;
        const state = this.state(id);
        try {
          const source = new URL(account.sourceUrl), parts = source.pathname.split('/').filter(Boolean);
          if (parts[0] !== 'live' || parts.length < 4) continue;
          const url = new URL('/player_api.php', source);
          url.searchParams.set('username', decodeURIComponent(parts[1]));
          url.searchParams.set('password', decodeURIComponent(parts[2]));
          const response = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
          const info = response.ok ? (await response.json()).user_info : null;
          state.checked = new Date(this.now()).toISOString();
          const denied = response.status === 401 || info?.auth === 0 || info?.auth === '0'
            || /^(expired|disabled|banned)$/i.test(info?.status || '');
          if (denied) {
            state.code = response.status; state.stopped = true;
            state.reason = `provider_${/^(expired|disabled|banned)$/i.test(info?.status || '') ? info.status.toLowerCase() : 'authentication_rejected'}`;
            this.pool?.quarantine(id, Infinity);
          } else if (response.status === 403) {
            this.pool?.quarantine(id, this.failure(id, 403));
          } else if (Number(info?.auth) === 1) {
            if (state.stopped) {
              state.stopped = false; state.until = 0; state.reason = null; this.pool?.blocked.delete(id);
              for (const demand of this.pool?.demands.values() || []) if (demand.failedProvider === id) demand.failedUntil = 0;
            }
            if (state.until <= this.now()) { state.reason = null; state.code = response.status; }
          }
        } catch {
          // A metadata timeout is not evidence that a working streaming account expired.
        }
      }
    } finally { this.checking = false; this.pool?.rebalance(); this.persist(); }
  }
  snapshot() {
    const accounts = this.accounts();
    return PROVIDER_IDS.map((provider, index) => {
      const account = accounts[provider] || {}, state = this.state(provider);
      const lease = this.pool?.leases.get(provider);
      const demand = lease && this.pool.demands.get(lease.key);
      const stopped = !account.enabled || state.stopped;
      const cooldown = state.until > this.now();
      return { provider, id: account.id || `Account_${index + 1}_${provider === 'A' ? 'Primary' : account.username || provider}`,
        username: account.username || null, server: account.server || null,
        status: stopped ? 'STOPPED_EXPIRED' : cooldown ? 'COOLDOWN_403' : lease ? 'BUSY_STREAMING' : 'ACTIVE',
        current_channel: demand?.channel || null, current_match: demand?.key || null,
        last_http_code: state.code, stopped_reason: !account.enabled ? 'not_configured' : stopped || cooldown ? state.reason : null,
        last_checked_at: state.checked, cooldown_until: cooldown ? new Date(state.until).toISOString() : null, consecutive_403: state.failures };
    });
  }
  persist() {
    if (!this.path) return;
    const accounts = this.snapshot(), signature = JSON.stringify(accounts);
    if (signature === this.saved) return;
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify({ updated_at: new Date(this.now()).toISOString(), accounts }, null, 2), { mode: 0o600 });
      renameSync(`${this.path}.tmp`, this.path); this.saved = signature; this.writeFailed = false;
    } catch { if (!this.writeFailed) console.error('[account-health] Cannot write private account status file'); this.writeFailed = true; }
  }
}
