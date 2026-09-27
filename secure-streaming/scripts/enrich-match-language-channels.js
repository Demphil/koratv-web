import { fileURLToPath } from 'node:url';

// Compatibility entry point: channel assignments come exclusively from Kooora.
export async function enrichMatchChannels() {
  return { processed: 0, arabicUpdated: 0, alternativesUpdated: 0, disabled: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Gemini channel enrichment is disabled. Run sync:matches for Kooora assignments.');
}
