const config = {
  cron: process.env.MEDIA_QA_CRON || '*/5 * * * *',
  resolverTimeZone: process.env.MEDIA_QA_RESOLVER_TIME_ZONE || 'Africa/Casablanca',
  stagingCollection: process.env.SUPABASE_STAGING_TABLE || 'media_qa_staging',
  browserExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '',
  autoDiscoverLimit: Number(process.env.MEDIA_QA_AUTO_DISCOVER_LIMIT || 20)
};

module.exports = { config };
