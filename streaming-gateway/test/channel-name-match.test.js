import test from 'node:test';
import assert from 'node:assert/strict';
import { findChannelNameMatch } from '../../shared/channel-name-match.mjs';

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
    'AR-SPI MA ARRYADIA TNT'
  );
});
