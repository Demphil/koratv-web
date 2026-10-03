import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicMatchId, resolvePublicMatchId } from '../../shared/public-match-id.mjs';

const identities = ['kooora_2026-10-03_الرجاء_البيضاوي_vs_نهضه_الزمامره',
  'kooora_2026-10-03_اسبانيا_vs_تشيكيا', 'api-football_123', '12345'];

test('numeric public identities are stable, exact, and date-sensitive', () => {
  for (const id of identities) {
    const number = publicMatchId(id);
    assert.match(number, /^\d{20}$/);
    assert.equal(number, publicMatchId(id));
    assert.equal(resolvePublicMatchId(number, [{ match_id: id }, { match_id: id }]), id);
    assert.equal(resolvePublicMatchId(number, [{ match_id: `${id}_other` }]), '');
  }
  assert.notEqual(publicMatchId(identities[0]), publicMatchId(identities[0].replace('10-03', '10-04')));
  assert.equal(resolvePublicMatchId('00000000000000000000', identities.map(match_id => ({ match_id }))), '');
});

test('both sites and the player use exactly the same numeric mapping', () => {
  for (const [file, name] of [['../../assets/js/matches.js', 'opaqueWatchId'],
    ['../../../foottv6/assets/js/matches.js', 'opaqueWatchId'], ['../player/player.js', 'publicMatchId']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    for (const id of identities) assert.equal(vm.runInNewContext(`${source.slice(start, end)}; ${name}(id)`, { id }), publicMatchId(id));
  }
});

test('old links are canonicalized without navigation and numeric links are unchanged', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const start = source.indexOf('function replacePublicMatchUrl(');
  const end = source.indexOf('\n}', start) + 2;
  for (const input of [identities[0], publicMatchId(identities[0])]) {
    let address;
    vm.runInNewContext(`${source.slice(start, end)}; replacePublicMatchUrl(input)`, {
      input, publicMatchId, location: { pathname: '/739184.html' },
      history: { replaceState: (_, __, value) => { address = value; } },
    });
    assert.equal(address, `/739184.html?match=${publicMatchId(identities[0])}`);
  }
});
