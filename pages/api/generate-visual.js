import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function buildImagePrompt({ dreamText, interpretation, modeSelected }) {
  return `Convert this dream into a cinematic visual scene.

Style:
- dreamy
- cinematic
- mystical
- elegant

Keep:
- single scene
- clear subject
- strong mood and lighting

Dream:
${dreamText}

Interpretation:
${interpretation || ""}`;
}

async function generateImageWithProvider(imagePrompt) {
  console.log("🟡 [STEP 6] Image provider called");
  console.log("🟡 Prompt:", imagePrompt);

  return {
    imageUrl: "https://via.placeholder.com/1024x1024.png?text=Rouya+Dream+Visual"
  };
}

export default async function handler(req, res) {
 try {
  let body = {};

  if (typeof req.body === "string") {
    const trimmed = req.body.trim();
    body = trimmed ? JSON.parse(trimmed) : {};
  } else if (req.body && typeof req.body === "object") {
    body = req.body;
  }

  console.log("🔴 [STEP 1] Incoming raw req.body:", req.body);
  console.log("🔴 [STEP 1] Parsed body:", body);

  const dreamId = String(body.dreamId || "").trim();
  const userId = String(body.userId || "").trim();

  console.log("dreamId:", dreamId);
  console.log("userId:", userId);

  if (!dreamId) {
    return res.status(400).json({ error: "dreamId missing" });
  }

  if (!userId) {
    return res.status(400).json({ error: "userId missing" });
  }

    // 🔴 STEP 2: get profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    console.log("🔴 [STEP 2] Profile result:", profile);

    if (profileError) {
      console.error("❌ Profile error:", profileError);
      return res.status(500).json({ error: "Profile fetch failed" });
    }

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const plan = String(profile.plan || "free").toLowerCase();
    console.log("🟡 [STEP 2.1] Plan:", plan);

    // 🔴 STEP 3: plan check
    if (plan !== "plus" && plan !== "premium") {
      console.log("❌ Upgrade required, plan:", plan);
      return res.status(403).json({
        error: "upgrade required"
      });
    }

    // 🔴 STEP 4: get dream
    const { data: dream, error: dreamError } = await supabase
      .from("dreams")
      .select("*")
      .eq("id", dreamId)
      .eq("user_id", userId)
      .maybeSingle();

    console.log("🔴 [STEP 4] Dream found:", !!dream);

    if (dreamError) {
      console.error("❌ Dream fetch error:", dreamError);
      return res.status(500).json({ error: "Dream fetch failed" });
    }

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    // 🔴 STEP 5: existing image check
    if (dream.image_url) {
      console.log("🟢 [STEP 5] Reusing existing image");

      return res.status(200).json({
        ok: true,
        reused: true,
        imageUrl: dream.image_url
      });
    }

    // 🔴 STEP 6: prepare prompt
    const interpretation =
      dream.result_internal ||
      dream.result_traditional ||
      "";

    const imagePrompt = buildImagePrompt({
      dreamText: dream.dream_text,
      interpretation,
      modeSelected: dream.mode_selected
    });

    console.log("🟡 [STEP 6] Generated image prompt:", imagePrompt);

    // 🔴 STEP 7: call provider
    const generated = await generateImageWithProvider(imagePrompt);

    console.log("🟡 [STEP 7] Provider response:", generated);

    if (!generated?.imageUrl) {
      return res.status(500).json({
        error: "Image generation failed"
      });
    }

    // 🔴 STEP 8: save to DB
    const { error: updateError } = await supabase
      .from("dreams")
      .update({
        image_prompt: imagePrompt,
        image_url: generated.imageUrl
      })
      .eq("id", dreamId)
      .eq("user_id", userId);

    console.log("🟢 [STEP 8] Saved image_url:", generated.imageUrl);

    if (updateError) {
      console.error("❌ Update error:", updateError);
      return res.status(500).json({
        error: "DB update failed"
      });
    }

    return res.status(200).json({
      ok: true,
      imageUrl: generated.imageUrl
    });
  } catch (err) {
    console.error("💥 [FATAL ERROR]:", err);

    return res.status(500).json({
      error: "Server error",
      detail: err.message
    });
  }
}
