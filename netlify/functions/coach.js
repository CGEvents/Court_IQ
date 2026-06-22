// Court IQ — secure server endpoint (Netlify Function)
// Place this file at:  netlify/functions/coach.js
// It keeps your GEMINI_API_KEY secret and talks to Google Gemini on the kids' behalf.
// The browser app calls POST /api/coach with { prompt } (see netlify.toml redirect).

const SAFETY = `You are "Coach IQ", a friendly upbeat basketball coach in an app used by kids (some as young as 11), teens and adults.
RULES: Only discuss basketball — skills, training, mindset, effort, teamwork, sportsmanship, athlete sleep/food/hydration, bouncing back from mistakes.
Keep replies SHORT (2-3 sentences), warm, simple. Praise effort over results. No medical/diet/weight advice; for pain say rest and tell a parent/coach.
If the user mentions self-harm, being unsafe, abuse, or wanting to give up on life (not just basketball), do NOT coach — warmly tell them this is bigger than basketball and to talk to a parent, teacher or trusted adult right away. No bad language. Never ask for personal info.`;

// Server-side distress catch (belt and braces, before hitting the model)
const RED_FLAGS = ["kill myself","suicide","want to die","end my life","hurt myself","self harm","self-harm","cutting","no reason to live","abuse","being hit","scared at home"];
const DISTRESS_REPLY = "That sounds like a lot more than basketball, and it matters more than any game. Please talk to a parent, teacher, or another adult you trust about this today — reaching out is a brave, strong move.";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "POST only" }) };

  try {
    const { prompt } = JSON.parse(event.body || "{}");
    if (!prompt || typeof prompt !== "string") {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Missing prompt" }) };
    }

    // distress shortcut — never sends these to the model
    const low = prompt.toLowerCase();
    if (RED_FLAGS.some(f => low.includes(f))) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text: DISTRESS_REPLY }) };
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text: null, note: "no_key" }) }; // app falls back to offline

    const model = "gemini-2.5-flash"; // free-tier workhorse
    // Send the key as the x-goog-api-key header (works with both old "AIza" keys
    // and the newer "AQ" auth keys). The old "?key=" query method rejects AQ keys.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body = {
      systemInstruction: { parts: [{ text: SAFETY }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.8 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      // rate limited or other — let the app fall back to offline banks
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text: null, note: "upstream_" + r.status }) };
    }

    const data = await r.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "").join("").trim();

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text: text || null }) };
  } catch (e) {
    // any error → null so the app uses its offline answer
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text: null, note: "error" }) };
  }
};
