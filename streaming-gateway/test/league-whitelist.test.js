import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedMatch, normalizeTeamName } from '../../shared/league-whitelist.mjs';

test('normalizes San Diego Arabic spelling variants for match dedupe', () => {
  assert.equal(normalizeTeamName('سان دييجو'), normalizeTeamName('سان دييغو'));
});

test('allows only requested women and African competition scope', () => {
  assert.equal(isAllowedMatch({
    league: 'الدوري الألماني لكرة القدم للسيدات',
    homeTeam: 'VfB Stuttgart',
    awayTeam: 'فيردر بريمن'
  }), false);

  assert.equal(isAllowedMatch({
    league: 'دوري أبطال أوروبا للسيدات',
    homeTeam: 'Chelsea Women',
    awayTeam: 'Barcelona Women'
  }), true);

  assert.equal(isAllowedMatch({
    league: 'الدوري المصري الممتاز',
    homeTeam: 'الأهلي',
    awayTeam: 'بيراميدز'
  }), false);

  assert.equal(isAllowedMatch({
    league: 'دوري أبطال أفريقيا',
    homeTeam: 'الأهلي',
    awayTeam: 'الوداد'
  }), true);

  assert.equal(isAllowedMatch({
    league: 'بطولة ودية',
    homeTeam: 'منتخب المغرب',
    awayTeam: 'منتخب السنغال'
  }), true);

  assert.equal(isAllowedMatch({
    league: 'بطولة ودية',
    homeTeam: 'منتخب الجزائر للسيدات',
    awayTeam: 'منتخب تونس للسيدات'
  }), true);
});
