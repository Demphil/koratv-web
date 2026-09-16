require('dotenv').config({ path: require('node:path').resolve(process.cwd(), '.env') });

// Metadata collection is intentionally independent from browser-based stream QA.
const metadata = require('./metadata-scraper');

if (require.main === module) {
  metadata.runMetadataOnce().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = metadata;
