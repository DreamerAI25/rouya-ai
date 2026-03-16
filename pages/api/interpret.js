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

  if (value === "geleneksel yorum") return "traditional";
  if (value === "içsel yansıtıcı yorum") return "internal";
  if (value === "icsel yansitici yorum") return "internal";

  if (value === "traditional interpretation") return "traditional";
  if (value === "reflective interpretation") return "internal";
  if (value === "inner reflective interpretation") return "internal";

  if (value === "التفسير التقليدي") return "traditional";
  if (value === "التفسير التأملي") return "internal";

  if (value.includes("traditional")) return "traditional";
  if (value.includes("reflective")) return "internal";
  if (value.includes("geleneksel")) return "traditional";
  if (value.includes("yansıtıcı") || value.includes("yansitici")) return "internal";
  if (value.includes("التقليدي")) return "traditional";
  if (value.includes("التأملي")) return "internal";

  return null;
}

function buildPrompt(modeSelected, dreamText) {
  const master = `You are Rouya, an AI dream interpretation assistant.

Rules:
- No predictions, no fear language, no absolute claims.
- No medical or psychological diagnosis.
- Warm, calm, human tone.
- Keep the interpretation concise but meaningful (120–250 words).
- End with ONE gentle reflective question.

Language behavior:
- First detect the intended language of the dream text.
- Always respond entirely in that same language.
- Ignore UI language.
- If Turkish is written without special characters (example: "Ruyamda eve donerken kayboldum"), still treat it as Turkish.`;

  const traditional = `Interpret the dream using a traditional cultural perspective.
Use soft phrasing such as "in some classical sources..." and avoid certainty.`;

  const internal = `Interpret the dream using a psychological and reflective perspective.
Focus on emotions and personal meaning rather than prediction.`;

  const modeText = modeSelected === "traditional" ? traditional : internal;

  return `${master}

${modeText}

Dream text:
${dreamText}`;
}

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

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

    const monthKey = getMonthKey();

    // Logged-in user flow
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

      if (profile.plan === "free" && (profile.dreams_used_month || 0) >= 3) {
        return res.status(403).json({
          error: "Monthly limit reached",
          message: "Bu ayki rüya hakkınız doldu (3). Plus veya Premium'a geçebilirsiniz.",
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

    // Anonymous flow
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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Claude API error",
        detail: data
      });
    }

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
      is_public: false
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
    return res.status(500).json({
      error: "Server error",
      detail: error.message
    });
  }
}
