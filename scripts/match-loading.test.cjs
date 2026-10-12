const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ prerendered = false, offline = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/matches.js'), 'utf8');
  const loading = source.slice(source.indexOf('async function loadAndRenderMatches('), source.indexOf('window.refreshLiveMatches ='));
  const renders = [];
  const context = vm.createContext({
    DOM: { featuredContainer: { querySelector: () => prerendered ? {} : null } },
    getCachedMatchSnapshot: () => ({ today: ['finished-only'], tomorrow: [] }),
    getTodayMatches: async options => {
      if (offline && options.throwOnError) throw new Error('offline');
      return offline ? ['finished-only'] : ['live', 'upcoming', 'finished'];
    },
    getTomorrowMatches: async () => [],
    renderMatchCollections: (...rows) => renders.push(rows),
  });
  vm.runInContext(loading, context);
  return { context, renders };
}

test('partial browser cache never replaces an existing prerendered schedule', () => {
  const { context, renders } = fixture({ prerendered: true });
  assert.equal(context.renderCachedMatchesImmediately(), false);
  assert.equal(renders.length, 0);
});

test('a failed refresh preserves the visible schedule instead of rendering partial fallback data', async () => {
  const { context, renders } = fixture({ prerendered: true, offline: true });
  await assert.rejects(context.loadAndRenderMatches(), /offline/);
  assert.equal(renders.length, 0);
});

test('successful live feed replaces the schedule and empty initial pages can use cached results', async () => {
  const { context, renders } = fixture();
  assert.equal(context.renderCachedMatchesImmediately(), true);
  await context.loadAndRenderMatches();
  assert.deepEqual(Array.from(renders[1][0]), ['live', 'upcoming', 'finished']);
});
