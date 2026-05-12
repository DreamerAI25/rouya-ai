import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeMode(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return null;

  if (value === "traditional") return "traditional";
  if (value === "internal") return "internal";

  if (value.includes("traditional")) return "traditional";
  if (value.includes("reflective")) return "internal";
  if (value.includes("internal")) return "internal";
  if (value.includes("geleneksel")) return "traditional";
  if (value.includes("yansıtıcı") || value.includes("yansitici")) return "internal";
  if (value.includes("التقليدي")) return "traditional";
  if (value.includes("التأملي")) return "internal";

  return null;
}

function normalizeDream(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function generateFingerprint(userId, dreamText, mode) {
  return `${userId}:${mode}:${normalizeDream(dreamText)}`;
}

function buildPrompt(modeSelected, dreamText) {
  const master = `You are Rouya, an AI dream interpretation assistant.

Rules:
- No predictions, no fear language, no absolute claims.
- No medical or psychological diagnosis.
- Warm, calm, human tone.
- Keep the interpretation concise but meaningful (120–250 words).
- Do NOT ask any follow-up questions.
- The interpretation must feel complete and final.

CRITICAL STRUCTURE:
- The interpretation MUST begin with 2 strong opening sentences.
- These first 2 sentences should feel emotionally engaging and create curiosity.
- They should hint at the meaning, but not reveal everything immediately.
- After those 2 opening sentences, continue with the full interpretation.

Language behavior:
- First detect the intended language of the dream text.
- Always respond entirely in that same language.
- Ignore UI language.
- If Turkish is written without special characters, still treat it as Turkish.

SPECIAL INSTRUCTION FOR TURKISH:
