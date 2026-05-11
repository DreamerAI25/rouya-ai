import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Allowed beta codes
const VALID_CODES = [
  "ROUYA2026",
  "DREAMBETA",
  "TESTPLUS"
];

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // ✅ Safe body parse
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});

    const userId = String(body.userId || "").trim();
    const betaCode = String(body.betaCode || "").trim().toUpperCase();

    console.log("🟡 Beta activation request");
    console.log("🟡 userId:", userId);
    console.log("🟡 betaCode:", betaCode);

    // ✅ Validate
    if (!userId) {
      return res.status(400).json({
        error: "userId missing"
      });
    }

    if (!betaCode) {
      return res.status(400).json({
        error: "betaCode missing"
      });
    }

    // ✅ Check code
    if (!VALID_CODES.includes(betaCode)) {
      return res.status(403).json({
        error: "invalid beta code"
      });
    }

    // ✅ Check profile exists
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("❌ profile lookup error:", profileError);

      return res.status(500).json({
        error: "profile lookup failed",
        detail: profileError.message
      });
    }

    // ✅ Create profile if missing
    if (!profile) {
      const { error: createError } = await supabase
        .from("profiles")
        .insert({
          user_id: userId,
          plan: "plus",
          dreams_used_month: 0,
          images_used_month: 0
        });

      if (createError) {
        console.error("❌ profile create error:", createError);

        return res.status(500).json({
          error: "profile creation failed",
          detail: createError.message
        });
      }
    } else {
      // ✅ Upgrade existing profile
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          plan: "plus",
          dreams_used_month: 0,
          images_used_month: 0
        })
        .eq("user_id", userId);

      if (updateError) {
        console.error("❌ profile update error:", updateError);

        return res.status(500).json({
          error: "profile update failed",
          detail: updateError.message
        });
      }
    }

    console.log("🟢 Beta activation success");

    return res.status(200).json({
      ok: true,
      activatedPlan: "plus",
      message: "Rouya Plus beta activated"
    });

  } catch (err) {
    console.error("💥 FATAL:", err);

    return res.status(500).json({
      error: "server error",
      detail: err.message
    });
  }
}
