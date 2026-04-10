import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function buildImagePrompt({ dreamText, interpretation, modeSelected }) {
  return `You are a visual prompt generator for Rouya AI.

Task:
Convert the following dream into a single, visually coherent image prompt.

Rules:
- Create ONE strong cinematic scene
- Keep it visually clear and not overcrowded
- Emphasize atmosphere, lighting, symbolism, and emotion
- Style should feel dreamy, cinematic, mystical, elegant
- Avoid text overlays, UI elements, split screens, collages
- Do not mention camera brands or artist names
- Keep the prompt concise but vivid
- Output only the final image prompt, nothing else

Interpretation mode:
${modeSelected}

Dream text:
${dreamText}

Interpretation:
${interpretation || ""}`;
}

async function generateImageWithProvider(imagePrompt) {
  /**
   * TODO:
   * Burayı daha sonra seçtiğin provider'a göre dolduracağız.
   *
   * Şimdilik mock response dönüyor.
   * İlk entegrasyonda burada gerçek image generation API çağrısı olacak.
   */

  // ÖRNEK MOCK URL
  return {
    imageUrl: "https://via.placeholder.com/1024x1024.png?text=Rouya+Dream+Visual",
    provider: "mock"
  };
}

export default async function handler(req, res) {
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
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const dreamId = String(body.dreamId || "").trim();
    const userId = String(body.userId || "").trim();

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId required" });
    }

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // 1) Kullanıcı profili ve plan kontrolü
    const { data: profile, error: profileError } = await supabase
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
      return res.status(404).json({
        error: "Profile not found"
      });
    }

    const plan = String(profile.plan || "free").toLowerCase();

    if (plan !== "plus" && plan !== "premium") {
      return res.status(403).json({
        error: "upgrade required",
        message:
          "Rüya görselleştirme özelliği için Rouya AI Plus veya Premium paketi gerekir."
      });
    }

    // 2) Rüya kaydını çek
    const { data: dream, error: dreamError } = await supabase
      .from("dreams")
      .select("*")
      .eq("id", dreamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (dreamError) {
      return res.status(500).json({
        error: "Dream lookup failed",
        detail: dreamError.message
      });
    }

    if (!dream) {
      return res.status(404).json({
        error: "Dream not found"
      });
    }

    // 3) Daha önce görselleştirilmişse yeniden üretme
    if (dream.image_url) {
      return res.status(200).json({
        ok: true,
        reused: true,
        dreamId: dream.id,
        imageUrl: dream.image_url,
        imagePrompt: dream.image_prompt || null
      });
    }

    // 4) Yorumu seç
    const interpretation =
      dream.result_internal ||
      dream.result_traditional ||
      "";

    const modeSelected = dream.mode_selected || "traditional";
    const dreamText = dream.dream_text || "";

    if (!dreamText) {
      return res.status(400).json({
        error: "Dream text missing"
      });
    }

    // 5) Önce görsel prompt üret
    const promptForPromptModel = buildImagePrompt({
      dreamText,
      interpretation,
      modeSelected
    });

    const promptResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: promptForPromptModel
          }
        ]
      })
    });

    const promptData = await promptResponse.json();

    if (!promptResponse.ok) {
      return res.status(500).json({
        error: "Image prompt generation failed",
        detail: promptData
      });
    }

    if (!promptData?.content?.length) {
      return res.status(500).json({
        error: "Empty image prompt response",
        detail: promptData
      });
    }

    const imagePrompt = String(promptData.content[0].text || "").trim();

    if (!imagePrompt) {
      return res.status(500).json({
        error: "Generated image prompt is empty"
      });
    }

    // 6) Seçilen provider ile görsel üret
    const generated = await generateImageWithProvider(imagePrompt);

    if (!generated?.imageUrl) {
      return res.status(500).json({
        error: "Image generation failed"
      });
    }

    // 7) Dreams tablosuna kaydet
    const { data: updatedDream, error: updateError } = await supabase
      .from("dreams")
      .update({
        image_prompt: imagePrompt,
        image_url: generated.imageUrl
      })
      .eq("id", dream.id)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        error: "Dream update failed",
        detail: updateError.message
      });
    }

    return res.status(200).json({
      ok: true,
      reused: false,
      dreamId: updatedDream.id,
      imageUrl: updatedDream.image_url,
      imagePrompt: updatedDream.image_prompt
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      detail: error.message
    });
  }
}
