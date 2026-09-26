import test from "node:test";
import assert from "node:assert/strict";
import { matchChannels, parseM3uText } from "../scripts/import-m3u.js";
import { buildUpdatePayload } from "../scripts/sync-iptv-provider.js";

test("M3U sync matches prefixed Arryadia names and keeps TNT separate from S/D", () => {
  const entries = parseM3uText([
    '#EXTINF:-1 tvg-name="AR-SPI MA ARRYADIA TNT",AR-SPI MA ARRYADIA TNT',
    "https://media.example.com/live/tnt.m3u8",
    '#EXTINF:-1 tvg-name="AR-SPI MA ARRYADIA S/D",AR-SPI MA ARRYADIA S/D',
    "https://media.example.com/live/sd.m3u8",
    '#EXTINF:-1 tvg-name="AR-SPI MA ARRYADIA HD 3",AR-SPI MA ARRYADIA HD 3',
    "https://media.example.com/live/hd3.m3u8"
  ].join("\n"));

  const matched = matchChannels(
    ["Arryadia TNT", "Arryadia S/D", "الرياضية المغربية 3"],
    entries,
    { candidatesPerChannel: 8 }
  );

  assert.deepEqual(matched.map(({ name, source_name }) => ({ name, source_name })), [
    { name: "Arryadia TNT", source_name: "AR-SPI MA ARRYADIA TNT" },
    { name: "Arryadia S/D", source_name: "AR-SPI MA ARRYADIA S/D" },
    { name: "الرياضية المغربية 3", source_name: "AR-SPI MA ARRYADIA HD 3" }
  ]);
});

test("provider refresh can reactivate an explicitly selected channel after validating its link", () => {
  const result = buildUpdatePayload(
    [{ id: 7, name: "Arryadia TNT", active: false, original_url: "https://media.example.com/live/tnt.m3u8" }],
    [{ name: "Arryadia TNT", original_url: "https://media.example.com/live/tnt.m3u8", source_name: "AR-SPI MA ARRYADIA TNT" }]
  );

  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].active, true);
  assert.deepEqual(result.unchanged, []);
  assert.deepEqual(result.missing, []);
});
