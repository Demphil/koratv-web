export async function fetchProviderArray(request, credentials, origin, action, {
  attempts = 3,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await request(credentials, origin, action);
      if (Array.isArray(value)) return value;
      lastError = new Error(`Provider returned a non-array response for ${action}`);
    } catch (error) { lastError = error; }
    if (attempt < attempts) await delay(250 * attempt);
  }
  return null;
}
