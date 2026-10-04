import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedMatch, normalizeTeamName } from '../../shared/league-whitelist.mjs';

test('Kooora Arabic international friendlies include Morocco and Argentina without admitting club or youth friendlies', () => {
  for (const [homeTeam, awayTeam] of [['المغرب', 'مالي'], ['الأرجنتين', 'بوركينا فاسو']]) {
    assert.equal(isAllowedMatch({ league: 'المباريات الودية', homeTeam, awayTeam }), true);
  }
  assert.equal(isAllowedMatch({ league: 'المباريات الودية', homeTeam: 'المغرب تحت 23', awayTeam: 'مالي تحت 23' }), false);
  assert.equal(isAllowedMatch({ league: 'المباريات الودية للسيدات', homeTeam: 'المغرب', awayTeam: 'مالي' }), false);
  assert.equal(isAllowedMatch({ league: 'المباريات الودية للأندية', homeTeam: 'Real Madrid', awayTeam: 'Barcelona' }), false);
  assert.equal(isAllowedMatch({ league: 'وديات الأندية', homeTeam: 'Real Madrid', awayTeam: 'Barcelona' }), false);
});

test('normalizes San Diego Arabic spelling variants for match dedupe', () => {
  assert.equal(normalizeTeamName('سان دييجو'), normalizeTeamName('سان دييغو'));
});

test('rejects women competitions and teams across all competition scopes', () => {
  assert.equal(isAllowedMatch({ league: 'الدوري الألماني للسيدات', homeTeam: 'Stuttgart', awayTeam: 'Bremen' }), false);
  assert.equal(isAllowedMatch({ league: 'دوري أبطال أوروبا للسيدات', homeTeam: 'Chelsea', awayTeam: 'Barcelona' }), false);
  assert.equal(isAllowedMatch({ league: 'بطولة ودية', homeTeam: 'منتخب الجزائر للسيدات', awayTeam: 'منتخب تونس للسيدات' }), false);
  assert.equal(isAllowedMatch({ league: 'Brazilian Serie A', leagueCountry: 'Brazil', homeTeam: 'Botafogo Women', awayTeam: 'Flamengo' }), false);
  assert.equal(isAllowedMatch({ league: 'Brazilian Serie A', leagueCountry: 'Brazil', homeTeam: 'Botafogo W', awayTeam: 'Flamengo' }), false);
  for (const league of ["UEFA Women's Champions League", 'Serie A Femminile', 'Liga MX Femenil', 'Frauen-Bundesliga', 'Liga F']) {
    assert.equal(isAllowedMatch({ league, homeTeam: 'Team One', awayTeam: 'Team Two' }), false, league);
  }

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
});

test('allows Gulf Cup under Arabic and English competition names', () => {
  for (const league of ['كأس الخليج العربي', 'كأس الخليج', 'Gulf Cup', 'Arabian Gulf Cup']) {
    assert.equal(isAllowedMatch({ league, homeTeam: 'Iraq', awayTeam: 'Oman' }), true, league);
  }
  assert.equal(isAllowedMatch({ league: 'Gulf Cup', homeTeam: 'Iraq Women', awayTeam: 'Oman' }), false);
  assert.equal(isAllowedMatch({ league: 'كأس الخليج العربي', homeTeam: 'العراق للسيدات', awayTeam: 'عمان' }), false);
});

test('allows Botafogo first-team aliases but rejects similarly named lower-division clubs', () => {
  assert.equal(isAllowedMatch({
    league: 'Brazilian Serie A',
    leagueCountry: 'Brazil',
    homeTeam: 'Botafogo',
    awayTeam: 'Flamengo'
  }), true);

  assert.equal(isAllowedMatch({
    league: 'Brazilian Serie A',
    leagueCountry: 'Brazil',
    homeTeam: 'Botafogo FR',
    awayTeam: 'Flamengo'
  }), true);

  assert.equal(isAllowedMatch({
    league: 'Brazilian Serie C',
    leagueCountry: 'Brazil',
    homeTeam: 'Botafogo',
    awayTeam: 'Maringá FC'
  }), false);

  assert.equal(isAllowedMatch({
    league: 'Brazilian Serie C',
    leagueCountry: 'Brazil',
    homeTeam: 'Botafogo-SP',
    awayTeam: 'Maringá FC'
  }), false);
});

test('rejects partial-name false positives and out-of-scope divisions', () => {
  for (const league of [
    'Canadian Premier League',
    'Premier League 2',
    'U19 Bundesliga',
    'Friendlies Clubs',
    'Botola 2',
    'Africa Cup of Nations U20',
    'Copa De La Liga',
    'Liga Premier Serie A'
  ]) {
    assert.equal(isAllowedMatch({ league, leagueCountry: 'World', homeTeam: 'Example FC', awayTeam: 'Another FC' }), false, league);
  }

  assert.equal(isAllowedMatch({ league: 'Botola Pro', leagueCountry: 'Morocco', homeTeam: 'Wydad AC', awayTeam: 'FUS Rabat' }), true);
  assert.equal(isAllowedMatch({ league: 'UEFA Nations League', homeTeam: 'England', awayTeam: 'Spain' }), true);
  assert.equal(isAllowedMatch({ league: 'International Friendlies', homeTeam: 'USA', awayTeam: 'Peru' }), true);
  assert.equal(isAllowedMatch({ league: 'Friendlies', homeTeam: 'Hungary U19', awayTeam: 'Bulgaria U19' }), false);
  assert.equal(isAllowedMatch({ league: 'AFC Asian Cup U20', homeTeam: 'Japan U20', awayTeam: 'Korea U20' }), true);
});
