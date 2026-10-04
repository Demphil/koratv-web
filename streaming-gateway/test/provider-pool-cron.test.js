import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderSyncScheduler, isSchedulerEntrypoint } from '../scripts/provider-pool-cron.js';

test('routes and assignments refresh every tick without renewing the provider catalog every minute', async () => {
  let now = 1;
  const calls = [];
  const tick = createProviderSyncScheduler({now:()=>now, env:{}, run:async (_lock,script)=>{calls.push(script); return 0;}});
  await tick();
  now += 60_000;
  await tick();
  assert.equal(calls.filter(s=>s.includes('sync-provider-pool')).length, 1);
  assert.equal(calls.filter(s=>s.includes('maintenance-sync')).length, 2);
  assert.equal(calls.filter(s=>s.includes('resource-assignment')).length, 2);
  now += 4 * 60 * 60_000;
  await tick();
  assert.equal(calls.filter(s=>s.includes('sync-provider-pool')).length, 2);
});

test('a failed route refresh never publishes assignments from a stale route snapshot', async () => {
  const calls = [];
  const tick = createProviderSyncScheduler({env:{}, log:()=>{}, run:async (_lock,script)=>{
    calls.push(script); return script.includes('maintenance-sync') ? 1 : 0;
  }});
  assert.equal(await tick(), false);
  assert.equal(calls.some(s=>s.includes('resource-assignment')), false);
});

test('overlapping ticks do not launch duplicate synchronization jobs', async () => {
  let release;
  const pending = new Promise(resolve=>{release=resolve;});
  const calls=[];
  const tick=createProviderSyncScheduler({env:{},run:async (_lock,script)=>{calls.push(script); await pending; return 0;}});
  const first=tick();
  assert.equal(await tick(), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls.length, 3);
});

test('a slow provider catalog renewal does not block the next minute of match reconciliation', async () => {
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const calls=[];
  const tick=createProviderSyncScheduler({env:{},run:async (_lock,script)=>{
    calls.push(script);
    if(script.includes('sync-provider-pool')) await pending;
    return 0;
  }});
  await tick();
  await tick();
  assert.equal(calls.filter(s=>s.includes('sync-provider-pool')).length,1);
  assert.equal(calls.filter(s=>s.includes('resource-assignment')).length,2);
  release();
});

test('the scheduler starts under PM2 ESM wrapper as well as direct node execution', () => {
  const path='/opt/koratv/current/streaming-gateway/scripts/provider-pool-cron.js';
  assert.equal(isSchedulerEntrypoint(path,path,''),true);
  assert.equal(isSchedulerEntrypoint(path,'/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js',path),true);
  assert.equal(isSchedulerEntrypoint(path,'/test/importer.js',''),false);
});
