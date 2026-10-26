import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../operator/console.js', import.meta.url), 'utf8');
const start = source.indexOf('    if (searchJob) {');
const end = source.indexOf('    const importedJob', start);
const searchUpdate = source.slice(start, end);
const sandbox = () => {
  const elements = { 'import-search': { disabled: true }, 'import-search-status': { textContent: 'searching' } };
  return { elements, searchJob: 'new-search', searchAcceptedVersion: 4, requestVersion: 4,
    snapshot: { jobs: [] }, $: id => elements[id], errors: {}, active: job => job.state === 'running',
    renderImportResults: result => { elements['import-search-status'].textContent = result.message; } };
};

test('a state request started before search acceptance cannot report a service restart', () => {
  const context = sandbox();
  vm.runInNewContext(searchUpdate, context);
  assert.equal(context.searchJob, 'new-search');
  assert.equal(context.elements['import-search'].disabled, true);
  assert.equal(context.elements['import-search-status'].textContent, 'searching');
  context.requestVersion = 5;
  context.snapshot.jobs = [{ id: 'new-search', state: 'complete', result: { message: 'confirmed postponed result' } }];
  vm.runInNewContext(searchUpdate, context);
  assert.equal(context.searchJob, '');
  assert.equal(context.elements['import-search'].disabled, false);
  assert.equal(context.elements['import-search-status'].textContent, 'confirmed postponed result');
  assert.match(source, /const requestVersion = \+\+stateRequestVersion/);
  assert.match(source, /searchAcceptedVersion = stateRequestVersion/);
});

test('a genuinely missing job in a later fresh snapshot still unlocks search', () => {
  const context = sandbox();
  context.requestVersion = 5;
  vm.runInNewContext(searchUpdate, context);
  assert.equal(context.searchJob, '');
  assert.equal(context.elements['import-search'].disabled, false);
  assert.match(context.elements['import-search-status'].textContent, /أُعيد تشغيل/);
});
