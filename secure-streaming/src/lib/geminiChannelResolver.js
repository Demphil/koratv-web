const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GEMINI_MODEL_NAME = GEMINI_MODEL.replace(/^models\//, "");

function cleanJson(text) {
  return String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function resolveBroadcastChannelsWithGemini(match) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const prompt = `
You are helping a private sports media QA system map football matches to verified broadcast channel names.
Return strict JSON only, with this shape:
{"ar":["channel name"],"fr":["channel name"],"en":["channel name"],"confidence":0.0,"notes":"short reason with source name"}

Rules:
- Return actual official or widely trusted broadcasters for this exact match.
- Prioritize trusted broadcaster families such as beIN SPORTS, SSC, Alkass, Abu Dhabi Sports, Dubai Sports, ON Time Sports, Arryadia, Shahid, ESPN, TNT Sports, Canal+, DAZN, Sky Sports, SuperSport, and league/cup official broadcasters.
- Return Arabic-language broadcasters in "ar", French-language broadcasters in "fr", and English-language broadcasters in "en".
- The provided existingChannel/source channel may be missing or unreliable. Do not copy it blindly.
- Use homeTeam, awayTeam, league, kickoff, and country/competition context to identify the real broadcaster.
- Do not infer an exact numbered channel only because the league is usually carried by a broadcaster.
- If you cannot name the trusted schedule/source used for the exact fixture, return empty arrays and confidence below 0.55.
- In notes, name the source used, for example "source: beIN official TV guide" or "source: competition broadcaster schedule".
- If uncertain, return an empty array for that language.
- Do not invent stream URLs. Channel names only.
- Prefer exact channel names with numbers when known, for example "beIN SPORTS HD 1" instead of just "beIN SPORTS".
- Keep confidence below 0.55 if you are not sure from trusted broadcaster information.

Match data:
${JSON.stringify(match, null, 2)}
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(cleanJson(text));

  return {
    ar: Array.isArray(parsed.ar) ? parsed.ar.filter(Boolean) : [],
    fr: Array.isArray(parsed.fr) ? parsed.fr.filter(Boolean) : [],
    en: Array.isArray(parsed.en) ? parsed.en.filter(Boolean) : [],
    confidence: Number(parsed.confidence || 0),
    notes: String(parsed.notes || "")
  };
}

export async function resolveBroadcastChannelsBatchWithGemini(matches) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  if (!matches.length) return new Map();

  const prompt = `
You are helping a private sports media QA system map football matches to verified broadcast channel names.
Return strict JSON only, with this shape:
{"items":[{"id":"match id","ar":["channel name"],"fr":["channel name"],"en":["channel name"],"confidence":0.0,"notes":"short reason with source name"}]}

Rules:
- Return actual official or widely trusted broadcasters for each exact match.
- Prioritize trusted broadcaster families such as beIN SPORTS, SSC, Alkass, Abu Dhabi Sports, Dubai Sports, ON Time Sports, Arryadia, Shahid, ESPN, TNT Sports, Canal+, DAZN, Sky Sports, SuperSport, and league/cup official broadcasters.
- Return Arabic-language broadcasters in "ar", French-language broadcasters in "fr", and English-language broadcasters in "en".
- The provided existingChannel/source channel may be missing or unreliable. Do not copy it blindly.
- Use homeTeam, awayTeam, league, kickoff, and country/competition context to identify the real broadcaster.
- Do not infer an exact numbered channel only because the league is usually carried by a broadcaster.
- If you cannot name the trusted schedule/source used for the exact fixture, return empty arrays and confidence below 0.55.
- In notes, name the source used, for example "source: beIN official TV guide" or "source: competition broadcaster schedule".
- If uncertain, return an empty array for that language.
- Do not invent stream URLs. Channel names only.
- Prefer exact channel names with numbers when known, for example "beIN SPORTS HD 1" instead of just "beIN SPORTS".
- Keep confidence below 0.55 if you are not sure from trusted broadcaster information.
- Preserve every input id exactly.

Match data:
${JSON.stringify(matches, null, 2)}
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "{\"items\":[]}";
  const parsed = JSON.parse(cleanJson(text));
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  return new Map(items.map((item) => [
    String(item.id || ""),
    {
      ar: Array.isArray(item.ar) ? item.ar.filter(Boolean) : [],
      fr: Array.isArray(item.fr) ? item.fr.filter(Boolean) : [],
      en: Array.isArray(item.en) ? item.en.filter(Boolean) : [],
      confidence: Number(item.confidence || 0),
      notes: String(item.notes || "")
    }
  ]));
}
