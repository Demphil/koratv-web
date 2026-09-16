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
You are a live sports media QA system. Your task is to find the exact, verified broadcast channel for the given football match occurring today or this week.
Return strict JSON only with this exact shape:
{"ar":["channel name"],"fr":["channel name"],"en":["channel name"],"confidence":0.0,"notes":"short reason with source name"}

CRITICAL RULES:
1. DO NOT GUESS. Use your Google Search tool to find the live TV schedule for this specific match.
2. Search trusted sources for exact TV listings (e.g., kooora.com, beinsports.com).
3. Return actual official or widely trusted broadcasters for this exact match.
4. Arabic channels in "ar", French in "fr", English in "en".
5. If you cannot find live confirmation, return empty arrays and confidence 0.0.

Match data:
${JSON.stringify(match, null, 2)}
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.1 }
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
You are a live sports media QA system. Your task is to find the exact, verified broadcast channels for these football matches.
Return strict JSON only with this exact shape:
{"items":[{"id":"match id","ar":["channel name"],"fr":["channel name"],"en":["channel name"],"confidence":0.0,"notes":"short reason"}]}

CRITICAL RULES:
1. DO NOT GUESS. Use your Google Search tool to find live TV schedules.
2. Preserve every input id exactly.
3. If not found, return empty arrays and confidence 0.0.

Matches:
${JSON.stringify(matches, null, 2)}
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.1 }
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