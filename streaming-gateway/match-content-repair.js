import { broadcastChannelCandidates, preferredBroadcastChannels } from '../shared/match-broadcasts.mjs';
import { contentWindow } from './match-content.js';

export function createMatchContentRepair({ pool, accounts, assignments, discover, warm, commit, now = Date.now }) {
  const cooldowns = new Map(), attempted = new Map();
  let running = false, cursor = 0;
  return async ({ match, playback, lease, revision, shouldContinue = () => true }) => {
    if (running || !discover || !contentWindow(match, now()) || !pool.valid(lease)) return null;
    const matchId = match.match_id || match.matchId;
    if ((cooldowns.get(matchId) || 0) > now()) return null;
    running = true;
    if (cooldowns.size >= 128) cooldowns.delete(cooldowns.keys().next().value);
    cooldowns.set(matchId, now() + 300_000);
    const source = lease.url;
    const active = () => shouldContinue() && pool.valid(lease) && lease.url === source;
    try {
      const reserved = new Set((assignments()?.assignments || []).filter(row => row.matchId !== matchId
        && !row.aliases?.includes(matchId)).map(row => row.providerId));
      const idle = Object.entries(accounts() || {}).filter(([id, row]) => row.enabled && !reserved.has(id)
        && !pool.leases.has(id) && !pool.probes.has(id) && (pool.blocked.get(id) || 0) <= now()).map(([id]) => id);
      if (!idle.length) return { status: 'waiting_free_provider' };
      const free = idle.slice(cursor % idle.length).concat(idle.slice(0, cursor % idle.length)).slice(0, 8);
      const channels = [...new Set([playback.channel_id, ...preferredBroadcastChannels(broadcastChannelCandidates(match))].filter(Boolean))];
      const ordered = channels.slice(cursor % channels.length).concat(channels.slice(0, cursor % channels.length));
      cursor++;
      let probes = 0;
      const providerProbes = new Map();
      const deadline = now() + 45_000;
      for (const channel of ordered) {
        if (!active() || probes >= 8 || now() >= deadline) break;
        const approved = new Map();
        const result = await discover(channel, free, async (provider, candidate, name) => {
          const candidateKey = `${matchId}:${provider}:${name}:${candidate.original_url}`;
          if (!active() || !free.includes(provider) || pool.leases.has(provider) || pool.probes.has(provider)
            || (attempted.get(candidateKey) || 0) > now() || (providerProbes.get(provider) || 0) >= 1
            || probes >= 8 || now() >= deadline) return false;
          probes++; providerProbes.set(provider, 1);
          if (attempted.size >= 512) attempted.delete(attempted.keys().next().value);
          attempted.set(candidateKey, now() + 480_000);
          try {
            const value = await pool.probe(provider, name, candidate.original_url,
              probe => warm({ ...playback, channel_id: name, match_id: matchId }, probe, { requireContent: true }), { idleOnly: true, timeoutMs: 20000 });
            if (value.ok && value.content?.status === 'verified') {
              approved.set(provider, { url: candidate.original_url, content: value.content }); return true;
            }
          } catch {}
          return false;
        });
        if (!active()) return null;
        const ids = Object.keys(result?.provider_sources || {});
        const provider = ids[0], evidence = approved.get(provider);
        if (ids.length !== 1 || !evidence || result.provider_sources[provider] !== evidence.url) continue;
        const guard = () => active() && !pool.leases.has(provider) && !pool.probes.has(provider)
          && now() - Date.parse(evidence.content.checkedAt) < 90_000;
        if (!guard()) return null;
        return await commit({ matchId, providerId: provider, channel: result.resolvedChannel,
          result, revision, content: evidence.content, guard });
      }
      return { status: 'no_confirmed_alternative' };
    } finally { running = false; }
  };
}
