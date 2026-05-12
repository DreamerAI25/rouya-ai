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
- If the dream text is Turkish, the first 2 opening sentences should feel more emotionally resonant and familiar to Turkish-speaking users.
- Do not sound robotic, academic, or overly formal.
- Do not ask a question.`;

  const traditional = `Interpret the dream using a traditional cultural perspective.

Focus on:
- symbols in the dream
- familiar cultural meanings
- classical dream symbolism

Style:
- warm
- symbolic
- clear
- culturally grounded
- never absolute`;

  const internal = `Interpret the dream using a psychological and reflective perspective.

Focus on:
- emotions in the dream
- inner tension, desire, uncertainty, or transition
- personal meaning rather than prediction

Style:
- reflective
- emotionally aware
- warm
- insightful
- never clinical
- never diagnostic`;

  return `${master}

${modeSelected === "traditional" ? traditional : internal}

Dream text:
${dreamText}`;
}

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function callClaudeWithRetry(payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🟡 Claude attempt ${attempt}`);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok) {
        console.log("🟢 Claude success");
        return data;
      }

      console.error("❌ Claude API error status:", response.status);
      console.error("❌ Claude API error detail:", data);

      const errorType = data?.error?.type;

      if (
        (errorType === "overloaded_error" || errorType === "rate_limit_error") &&
        attempt < retries
      ) {
        const delay = attempt * 2000;
        console.log(`🟡 Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(data?.error?.message || "Claude API failed");
    } catch (err) {
      console.error("❌ Claude retry failure:", err);

      if (attempt >= retries) {
        throw err;
      }

      const delay = attempt * 2000;
      console.log(`🟡 Retry after failure in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Claude API failed after retries");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" && req.body.trim()
        ? JSON.parse(req.body)
        : req.body || {};

    const dreamText = String(body.dreamText || "").trim();
    const rawMode = body.mode || "traditional";
    const compare = Boolean(body.compare);
    const anonKey = body.anonKey || null;
    const userId = body.userId || null;

    if (!dreamText) {
      return res.status(400).json({ error: "dreamText required" });
    }

    const modeSelected = normalizeMode(rawMode);

    if (!modeSelected) {
      return res.status(400).json({
        error: "mode must be 'traditional' or 'internal'",
        receivedMode: rawMode
      });
    }

    let fingerprint = null;

    if (userId) {
      fingerprint = generateFingerprint(userId, dreamText, modeSelected);

      const { data: existing, error: existingError } = await supabase
        .from("dreams")
        .select("*")
        .eq("user_id", userId)
        .eq("dream_fingerprint", fingerprint)
        .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(1);

      if (existingError) {
        return res.status(500).json({
          error: "Duplicate check failed",
          detail: existingError.message
        });
      }

      if (existing && existing.length > 0) {
        const d = existing[0];

        return res.status(200).json({
          ok: true,
          duplicate: true,
          dreamId: d.id,
          createdAt: d.created_at,
          compare,
          modeSelected,
          traditional: d.result_traditional,
          internal: d.result_internal
        });
      }
    }

    const monthKey = getMonthKey();

    if (userId) {
      let { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (profileError) {
        return res.status(500).json({
          error: "Profile lookup failed",
          detail: profileError.message
        });
      }

      if (!profile) {
        const { error: createProfileError } = await supabase
          .from("profiles")
          .insert({
            user_id: userId,
            plan: "free",
            dreams_used_month: 0,
            images_used_month: 0,
            month_key: monthKey,
            prefs: {}
          });

        if (createProfileError) {
          return res.status(500).json({
            error: "Profile creation failed",
            detail: createProfileError.message
          });
        }

        profile = {
          plan: "free",
          dreams_used_month: 0,
          month_key: monthKey
        };
      }

      if (profile.month_key !== monthKey) {
        const { error: resetError } = await supabase
          .from("profiles")
          .update({
            dreams_used_month: 0,
            images_used_month: 0,
            month_key: monthKey
          })
          .eq("user_id", userId);

        if (resetError) {
          return res.status(500).json({
            error: "Profile reset failed",
            detail: resetError.message
          });
        }

        profile.dreams_used_month = 0;
      }

      const { count, error: countError } = await supabase
        .from("dreams")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if (countError) {
        return res.status(500).json({
          error: "Dream count failed",
          detail: countError.message
        });
      }

      const interpreted = count || 0;

      if (String(profile.plan || "free").toLowerCase() === "free" && interpreted >= 3) {
        return res.status(403).json({
          error: "limit reached",
          message:
            "Ücretsiz 3 rüya hakkınızı tamamladınız. Daha fazlası için Rouya Plus’a geçin.",
          plan: "free",
          limit: 3
        });
      }

      const { error: incError } = await supabase
        .from("profiles")
        .update({
          dreams_used_month: (profile.dreams_used_month || 0) + 1
        })
        .eq("user_id", userId);

      if (incError) {
        return res.status(500).json({
          error: "Profile quota update failed",
          detail: incError.message
        });
      }
    }

    if (!userId) {
      const { data: anonRow, error: anonLookupError } = await supabase
        .from("anon_usage")
        .select("*")
        .eq("anon_key", anonKey)
        .maybeSingle();

      if (anonLookupError) {
        return res.status(500).json({
          error: "Anonymous usage lookup failed",
          detail: anonLookupError.message
        });
      }

      if (anonRow && anonRow.used_count >= 1) {
        return res.status(403).json({
          error: "Free limit reached",
          message: "Bir rüya hakkını kullandınız. Devam etmek için lütfen üyelik oluşturun."
        });
      }

      if (anonRow) {
        const { error: anonUpdateError } = await supabase
          .from("anon_usage")
          .update({
            used_count: anonRow.used_count + 1,
            updated_at: new Date().toISOString()
          })
          .eq("anon_key", anonKey);

        if (anonUpdateError) {
          return res.status(500).json({
            error: "Anonymous usage update failed",
            detail: anonUpdateError.message
          });
        }
      } else {
        const { error: anonInsertError } = await supabase
          .from("anon_usage")
          .insert({
            anon_key: anonKey,
            used_count: 1
          });

        if (anonInsertError) {
          return res.status(500).json({
            error: "Anonymous usage insert failed",
            detail: anonInsertError.message
          });
        }
      }
    }

    const prompt = buildPrompt(modeSelected, dreamText);

    const data = await callClaudeWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    if (!data || !data.content || !data.content.length) {
      return res.status(500).json({
        error: "Claude response empty",
        raw: data
      });
    }

    const interpretation = data.content[0].text;

    const insertPayload = {
      dream_text: dreamText,
      mode_selected: modeSelected,
      result_traditional: modeSelected === "traditional" ? interpretation : null,
      result_internal: modeSelected === "internal" ? interpretation : null,
      user_id: userId || null,
      is_public: false,
      dream_fingerprint: fingerprint
    };

    const { data: insertedDream, error: insertError } = await supabase
      .from("dreams")
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({
        error: "Dream insert failed",
        detail: insertError.message
      });
    }

    return res.status(200).json({
      ok: true,
      dreamId: insertedDream?.id || null,
      createdAt: insertedDream?.created_at || new Date().toISOString(),
      compare,
      modeSelected,
      traditional: modeSelected === "traditional" ? interpretation : null,
      internal: modeSelected === "internal" ? interpretation : null
    });
  } catch (error) {
    console.error("💥 Server error:", error);

    return res.status(500).json({
      error: "Server error",
      detail: error.message
    });
  }
}
