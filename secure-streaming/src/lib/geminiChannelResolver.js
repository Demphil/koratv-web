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

  // تحديث الـ Prompt وتوجيهه لاستخدام البحث والمواقع الموثوقة
  const prompt = `
You are a live sports media QA system. Your task is to find the exact, verified broadcast channel for the given football match occurring today or this week.
Return strict JSON only, with this shape:
{"ar":["channel name"],"fr":["channel name"],"en":["channel name"],"confidence":0.0,"notes":"short reason with source name"}

CRITICAL RULES:
1. DO NOT GUESS. You MUST use your Google Search tool to find the live TV schedule for this specific match.
2. Search trusted sources for exact TV listings, prioritizing:
   - kooora.com (for Arabic schedules)
   - beinsports.com/ar/tv-guide (for beIN matches)
   - ssc.sa (for Saudi matches)
   - canalplus.com (for French)
   - skysports.com or tntsports.co.uk (for English)
3. Return actual official or widely trusted broadcasters for this exact match.
4. Prefer exact channel names with numbers when known (e.g., "beIN Sports HD 1" instead of "beIN Sports").
5. Arabic channels in "ar", French in "fr", English in "en".
6. In notes, state exactly which website confirmed this (e.g., "source: kooora.com match page").
7. If you cannot find live confirmation via search, return empty arrays and confidence 0.0.
8. Only output the raw JSON object. Do not add markdown blocks if possible.

Match data to search for:
${JSON.stringify(match, null, 2)}
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // تفعيل محرك بحث جوجل للذكاء الاصطناعي لكي يجلب البيانات الحية!
      tools: [{ googleSearch: {} }], 
      generationConfig: {
        temperature: 0.1, // تقليل الحرارة لمنع التأليف تماماً
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