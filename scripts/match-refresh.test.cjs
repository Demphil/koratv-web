const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/matches.js'), 'utf8');

test('the exact kickoff boundary reorders the displayed snapshot without a network read or page reload', () => {
  const now = Date.parse('2026-11-17T20:00:00Z');
  const snapshot = { today: [{ scheduledAt: new Date(now + 5000).toISOString() }], tomorrow: [] };
  let timer, renders = 0;
  const context = vm.createContext({
    displayedMatches: snapshot, matchBoundaryTimer: null, Date: { now: () => now }, document: { hidden: false },
    matchStartDate: match => new Date(match.scheduledAt), clearTimeout() {},
    setTimeout: (callback, delay) => { timer = { callback, delay }; return 1; },
    renderMatchCollections: (today, tomorrow) => { assert.equal(today, snapshot.today); assert.equal(tomorrow, snapshot.tomorrow); renders++; },
  });
  const block = source.slice(source.indexOf('function scheduleMatchBoundary('), source.indexOf('function renderMatchCollections('));
  vm.runInContext(`${block};scheduleMatchBoundary()`, context);
  assert.equal(timer.delay, 5025);
  timer.callback(); assert.equal(renders, 1);
  context.document.hidden = true; timer.callback(); assert.equal(renders, 1);
});

test('card reconciliation moves existing unaffected nodes instead of clearing the match container', () => {
  const block = source.slice(source.indexOf('function renderSection('), source.indexOf('function compareBroadcastPriority('));
  class Element {
    constructor(id) { this.id = id; this.dataset = {}; }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  }
  const container = { dataset: {}, children: [], insertBefore(node, before) {
    if (node.parent) node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node); node.parent = this;
  } };
  const context = vm.createContext({ Set, Map, matchIdentity: match => match.id,
    matchRenderSignature: match => `${match.id}:${match.status}`, createMatchElement: match => new Element(match.id) });
  const render = vm.runInContext(`${block};renderSection`, context);
  const first = { id: 'first', status: 'live' }, second = { id: 'second', status: 'live' };
  render(container, [first, second], ''); const firstNode = container.children[0], secondNode = container.children[1];
  render(container, [second, first], '');
  assert.equal(container.children[0], secondNode); assert.equal(container.children[1], firstNode);
  render(container, [{ ...second, status: 'ended' }, first], '');
  assert.equal(container.children[1], firstNode); assert.notEqual(container.children[0], secondNode);
});
