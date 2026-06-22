// Court IQ — secure server endpoint (Vercel serverless function)
// Place this file at:  api/coach.js
// It keeps your GEMINI_API_KEY secret and talks to Google Gemini on the kids' behalf.
// The browser app calls POST /api/coach with { prompt }.

const SAFETY = `You are "Coach IQ", a friendly upbeat basketball coach in an app used by kids (some as young as 11), teens and adults.
RULES: Only discuss basketball — skills, training, mindset, effort, teamwork, sportsmanship, athlete sleep/food/hydration, bouncing back from mistakes.
Keep replies SHORT (2-3 sentences), warm, simple. Praise effort over results. No medical/diet/weight advice; for pain say rest and tell a parent/coach.
If the user mentions self-harm, being unsafe, abuse, or wanting to give up on life (not just basketball), do NOT coach — warmly tell them this is bigger than basketball and to talk to a parent, teacher or trusted adult right away. No bad language. Never ask for personal info.`;

// Server-side distress catch (belt and braces, before hitting the model)
const RED_FLAGS = ["kill myself","suicide","want to die","end my life","hurt myself","self harm","self-harm","cutting","no reason to live","abuse","being hit","scared at home"];
const DISTRESS_REPLY = "That sounds like a lot more than basketball, and it matters more than any game. Please talk to a parent, teacher, or another adult you trust about this today — reaching out is a brave, strong move.";

export default async function handler(req, res) {
  // CORS so the page can call it
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // distress shortcut — never sends these to the model
    const low = prompt.toLowerCase();
    if (RED_FLAGS.some(f => low.includes(f))) {
      return res.status(200).json({ text: DISTRESS_REPLY });
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(200).json({ text: null, note: "no_key" }); // app falls back to offline

    const model = "gemini-2.5-flash"; // free-tier workhorse
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      // rate limited or other — let the app fall back to offline banks
      return res.status(200).json({ text: null, note: "upstream_" + r.status });
    }

    const data = await r.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "").join("").trim();

    return res.status(200).json({ text: text || null });
  } catch (e) {
    // any error → null so the app uses its offline answer
    return res.status(200).json({ text: null, note: "error" });
  }
}
