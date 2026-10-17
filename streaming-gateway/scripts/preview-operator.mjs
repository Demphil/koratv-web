import express from 'express';
import { registerOperatorConsole } from '../operator-console.js';
import { emptyOperatorState } from '../operator-state.js';
import { randomUUID } from 'node:crypto';

// Local UI fixture only: never reads credentials or contacts a supplier.
const app = express(); app.use(express.json());
const state = emptyOperatorState(); state.selection = { enabled: true, matches: ['fixture-1'] };
const matches = [
  ['برشلونة', 'غلطة سراي', 'دوري أبطال أوروبا', 'beIN SPORTS HD 1'],
  ['المغرب', 'مالي', 'المباريات الودية', 'Arryadia TNT'],
  ['إسبانيا', 'كرواتيا', 'دوري الأمم الأوروبية', 'beIN SPORTS HD 2'],
].map(([homeTeam, awayTeam, league, channelName], i) => ({ matchId: `fixture-${i + 1}`, homeTeam, awayTeam, league, channelName, broadcastChannels: [channelName], isLive: true, status: 'LIVE', time: '20:00', score: '1 - 0', sourceReady: true, viewingMode: 'stream', assignedProvider: String.fromCharCode(65 + i), boundProvider: '' }));
const jobs = [], requests = new Map();
const accounts = ['A', 'B', 'D', 'F', 'G', 'H', 'I', 'J'].map(provider => ({ provider, status: 'READY', matchIds: matches.filter(m => m.assignedProvider === provider).map(m => m.matchId) }));
app.get('/api/operator/state', (req, res) => res.json({ csrf: 'local-fixture', state, matches, channels: [], jobs, providers: accounts.map(a => ({ id: a.provider })), status: { accounts, prewarm: { warmed: 3, failed: 0 } } }));
app.get('/api/operator/channels', (_req, res) => res.json({ channels: [] }));
for (const match of matches) match.providerOwners = Object.fromEntries(accounts.map(account => [account.provider, account.matchIds.filter(id => id !== match.matchId)]));
for (const kind of ['channel', 'provider', 'refresh-links', 'selection', 'matches/refresh', 'matches/stop', 'matches/resume']) app.post(`/api/operator/${kind}`, (req, res) => {
  const previous = requests.get(req.body.requestId); if (previous) return res.status(202).json({ job: previous });
  const job = { id: randomUUID(), kind: kind === 'matches/refresh' ? 'metadata_refresh' : kind === 'refresh-links' ? 'refresh' : kind, state: 'running', phase: kind === 'matches/refresh' ? 'refreshing_metadata' : 'testing_media', matchId: req.body.matchId, matchIds: req.body.matchIds }; jobs.push(job); requests.set(req.body.requestId, job);
  setTimeout(() => { job.state = 'complete'; job.phase = 'ready'; const match = matches.find(m => m.matchId === job.matchId); if (kind === 'provider' && match) match.boundProvider = match.assignedProvider = req.body.providerId; if (kind === 'channel' && match) match.channelName = req.body.channel;
    if (kind === 'matches/refresh') { state.metadataRefreshedAt = new Date().toISOString(); matches[0].status = 'RESULT'; matches[0].isLive = false; matches[0].sourceReady = false; matches[0].score = '2 - 1'; }
    if (kind === 'matches/stop' && match) { match.paused = true; match.sourceReady = false; }
    if (kind === 'matches/resume' && match) { match.paused = false; match.sourceReady = true; }
  }, 1500);
  res.status(202).json({ job });
});
registerOperatorConsole(app, { config: { operatorConsolePath: '/preview-operator' }, redis: {}, clientIp: () => 'local', getMatches: async () => [], status: () => ({}) });
app.listen(8462, '127.0.0.1', () => console.log('Local UI fixture: http://127.0.0.1:8462/preview-operator'));
