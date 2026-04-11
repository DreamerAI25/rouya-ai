import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔹 IMAGE PROMPT BUILDER
function buildImagePrompt({ dreamText, interpretation }) {
  return `Create a cinematic dream scene.

Style:
- dreamy
- mystical
- cinematic lighting
- emotional atmosphere

Scene:
${dreamText}

Meaning:
${interpretation || ""}

Single clear visual moment.`;
}

// 🔹 MOCK IMAGE GENERATOR (SAFE)
async function generateImageWithProvider(prompt) {
  console.log("🟡 [STEP 6] Generating mock image");

  return {
  imageUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1024&q=80"
};
}

// 🔹 MAIN HANDLER
export default async function handler(req, res) {
  // ✅ CORS SAFE
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ SAFE BODY PARSE
    let body = {};

    if (req.body && typeof req.body === "object") {
      body = req.body;
    }

    console.log("🔴 Incoming body:", body);

    const dreamId = body?.dreamId;
    const userId = body?.userId;

    console.log("🔴 dreamId:", dreamId);
    console.log("🔴 userId:", userId);

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId missing" });
    }

    if (!userId) {
      return res.status(400).json({ error: "userId missing" });
    }

    // 🔹 GET USER PROFILE
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    console.log("🟡 profile:", profile);

    if (profileError) {
      console.error("❌ profile error:", profileError);
      return res.status(500).json({ error: "profile fetch failed" });
    }

    const plan = String(profile?.plan || "free").toLowerCase();
    console.log("🟡 plan:", plan);

    if (plan !== "plus" && plan !== "premium") {
      return res.status(403).json({
        error: "upgrade required"
      });
    }

    // 🔹 GET DREAM
    const { data: dream, error: dreamError } = await supabase
      .from("dreams")
      .select("*")
      .eq("id", dreamId)
      .eq("user_id", userId)
      .single();

    console.log("🟡 dream found:", !!dream);

    if (dreamError) {
      console.error("❌ dream error:", dreamError);
      return res.status(500).json({ error: "dream fetch failed" });
    }

    if (!dream) {
      return res.status(404).json({ error: "dream not found" });
    }

    // 🔹 REUSE EXISTING IMAGE
    if (dream.image_url) {
      console.log("🟢 using existing image");

      return res.status(200).json({
        ok: true,
        reused: true,
        imageUrl: dream.image_url
      });
    }

    // 🔹 BUILD PROMPT
    const interpretation =
      dream.result_internal ||
      dream.result_traditional ||
      "";

    const imagePrompt = buildImagePrompt({
      dreamText: dream.dream_text,
      interpretation
    });

    console.log("🟡 imagePrompt:", imagePrompt);

    // 🔹 GENERATE IMAGE
    const generated = await generateImageWithProvider(imagePrompt);

    console.log("🟡 provider response:", generated);

    if (!generated?.imageUrl) {
      return res.status(500).json({
        error: "image generation failed"
      });
    }

    // 🔹 SAVE TO DB
    const { error: updateError } = await supabase
      .from("dreams")
      .update({
        image_prompt: imagePrompt,
        image_url: generated.imageUrl
      })
      .eq("id", dreamId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("❌ update error:", updateError);
      return res.status(500).json({
        error: "db update failed"
      });
    }

    console.log("🟢 saved image");

    return res.status(200).json({
      ok: true,
      imageUrl: generated.imageUrl
    });
  } catch (err) {
    console.error("💥 FATAL:", err);

    return res.status(500).json({
      error: "server error",
      detail: err.message
    });
  }
}
