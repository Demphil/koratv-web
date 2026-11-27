const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN, EXPECTED_ARTIFACT } = process.env;
if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY || '') || !/^\d+$/.test(GITHUB_RUN_ID || '') || !GH_TOKEN || !EXPECTED_ARTIFACT) {
  throw new Error('Missing Pages artifact verification configuration.');
}
const endpoint = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts`;
let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Artifact verification returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body.artifacts?.some(item => item.name === EXPECTED_ARTIFACT && !item.expired)) { ready = true; break; }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!ready) throw new Error('The uploaded artifact is not available yet; the existing live website is unchanged.');
console.log('Website artifact is ready for deployment.');
