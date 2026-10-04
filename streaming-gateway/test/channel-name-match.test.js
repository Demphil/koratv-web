import test from 'node:test';
import assert from 'node:assert/strict';
import { findChannelNameMatch } from '../../shared/channel-name-match.mjs';
import { matchChannels, isCatalogChannelSourceVerified } from '../../shared/provider-channel-match.mjs';

test('exact Arryadia number and On Sport Plus edition cannot downgrade to the ordinary channel', () => {
  const entries = ['MA - ARRYADIA 1 HD', 'MA - ARRYADIA 3 HD', 'EGY| ON SPORT HD',
    'EGY| ON SPORT PLUS HEVC', 'EGY| ON SPORT PLUS HD'].map((name, index) => ({name, rawName:name, group:'AR', url:`https://example.test/${index}`}));
  const matched = matchChannels(['Arryadia 3 HD', 'On Sport Plus'], entries);
  assert.equal(matched.find(row=>row.name==='Arryadia 3 HD').source_name, 'MA - ARRYADIA 3 HD');
  assert.equal(matched.find(row=>row.name==='On Sport Plus').source_name, 'EGY| ON SPORT PLUS HD');
  assert.equal(isCatalogChannelSourceVerified('On Sport Plus', {sourceNames:{A:'EGY| ON SPORT HD'}}, 'A'), false);
  assert.equal(isCatalogChannelSourceVerified('Arryadia 3 HD', {sourceNames:{A:'MA - ARRYADIA 1 HD'}}, 'A'), false);
  assert.equal(findChannelNameMatch('Arryadia 3 HD', ['Arryadia TNT']), null);
  assert.equal(findChannelNameMatch('Arryadia TNT', ['Arryadia 3 HD']), null);
  for (const name of ['أون سبورت بلاس', 'أون سبورت بلس']) {
    assert.equal(matchChannels([name], entries)[0].source_name, 'EGY| ON SPORT PLUS HD');
    assert.equal(findChannelNameMatch(name, ['EGY| ON SPORT HD', 'EGY| ON SPORT PLUS HD']), 'EGY| ON SPORT PLUS HD');
    assert.equal(isCatalogChannelSourceVerified(name, {sourceNames:{A:'EGY| ON SPORT HD'}}, 'A'), false);
  }
});

test('matches IPTV prefixes and spelling variants without losing the channel number', () => {
  assert.equal(
    findChannelNameMatch('Arryadia HD 3', ['AR-SPI MA ARRYADIA HD 1', 'AR-SPI MA ARRYADIA HD 3']),
    'AR-SPI MA ARRYADIA HD 3'
  );
  assert.equal(
    findChannelNameMatch('AR-SPI MA ARRYADIA HD 3', ['الرياضية المغربية 1', 'الرياضية المغربية 3']),
    'الرياضية المغربية 3'
  );
  assert.equal(
    findChannelNameMatch('Arryadia TNT', ['AR-SPI MA ARRYADIA TnT']),
    'AR-SPI MA ARRYADIA TnT'
  );
});

test('does not cross channel variants or choose an ambiguous stream', () => {
  assert.equal(findChannelNameMatch('Arryadia HD 1', ['AR-SPI MA ARRYADIA TNT']), null);
  assert.equal(findChannelNameMatch('Arryadia', ['Arryadia HD 1', 'Arryadia HD 3']), null);
});

test('matches Arabic and Latin Arryadia aliases across IPTV prefixes', () => {
  assert.equal(
    findChannelNameMatch('الرياضية المغربية 3', ['AR-SPI MA ARRYADIA HD 1', 'AR-SPI MA ARRYADIA HD 3']),
    'AR-SPI MA ARRYADIA HD 3'
  );
  assert.equal(
    findChannelNameMatch('AR-SPI MA ARRYADIA TNT', ['الرياضية المغربية TNT', 'الرياضية المغربية HD 3']),
    'الرياضية المغربية TNT'
  );
  assert.equal(
    findChannelNameMatch('الرياضية المغربية', ['AR-SPI MA ARRYADIA HD 1']),
    'AR-SPI MA ARRYADIA HD 1'
  );
  assert.equal(
    findChannelNameMatch('Arryadia HD 3', ['AR-SPI MA ARRYADIA S/D', 'AR-SPI MA ARRYADIA TNT']),
    null
  );
  assert.equal(
    findChannelNameMatch('SNRT', ['AR-SPI MA ARRYADIA TNT', 'AR-SPI MA ARRYADIA HD 3']),
    'AR-SPI MA ARRYADIA TNT'
  );
  assert.equal(
    findChannelNameMatch('SNRT Live', ['Arryadia TNT', 'Arryadia HD 3']),
    'Arryadia TNT'
  );
});

test('matches platform broadcaster aliases requested by daily route sync', () => {
  assert.equal(findChannelNameMatch('SABC Plus', ['SABC+ HD', 'SABC 1']), 'SABC+ HD');
  assert.equal(findChannelNameMatch('DStv Now', ['DSTVNow Sports', 'SuperSport Maximo 1']), 'DSTVNow Sports');
  assert.equal(findChannelNameMatch('TOD TV', ['TOD', 'TV3']), 'TOD');
  assert.equal(findChannelNameMatch('beIN SPORTS CONNECT', ['beIN Connect HD', 'beIN SPORTS HD 1']), 'beIN Connect HD');
  assert.equal(findChannelNameMatch('Disney+ Premium', ['Disney Plus Premium HD', 'Disney Channel']), 'Disney Plus Premium HD');
});

test('keeps important route variants for language and premium editions', () => {
  assert.equal(findChannelNameMatch('beIN Sports ENG 1', ['beIN SPORTS HD 1', 'beIN SPORTS ENG 1 HD']), 'beIN SPORTS ENG 1 HD');
  assert.equal(findChannelNameMatch('beIN Sports ENG 2', ['beIN SPORTS ENG 1 HD', 'beIN SPORTS HD 2']), null);
  assert.equal(findChannelNameMatch('Disney+ Premium', ['Disney Plus HD']), null);
});
