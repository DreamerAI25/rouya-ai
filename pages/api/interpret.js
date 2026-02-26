import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  }
  return createClient(url, serviceKey);
}

export default async function handler(req, res) {
  try {
    // V1 kolay test için: GET ile de çalışsın
    // Prod'da sadece POST bırakacağız.
    const isPost = req.method === "POST";
    const isGet = req.method === "GET";
    if (!isPost && !isGet) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = isPost ? req.body : req.query;

    const dreamText = (body.dreamText || "").toString().trim();
    const modeSelected = (body.mode || "traditional").toString(); // traditional | internal
    const userId = body.userId ? body.userId.toString() : null;   // V1: opsiyonel
    const anonKey = (body.anonKey || "").toString() || null;      // V1: opsiyonel

    if (!dreamText) {
      return res.status(400).json({ error: "dreamText is required" });
    }
    if (!["traditional", "internal"].includes(modeSelected)) {
      return res.status(400).json({ error: "mode must be 'traditional' or 'internal'" });
    }

    const supabase = getSupabaseAdmin();

    // 1) Anon kullanıcı: 1 adet hak
    if (!userId) {
      if (!anonKey) {
        // anonKey olmadan abuse kontrol yapamayız → V1 test için zorunlu kılıyoruz
        return res.status(400).json({ error: "anonKey is required when userId is not provided" });
      }

      const { data: anonRow, error: anonReadErr } = await supabase
        .from("anon_usage")
        .select("used_count")
        .eq("anon_key", anonKey)
        .maybeSingle();

      if (anonReadErr) {
        return res.status(500).json({ error: "anon_usage read failed", detail: anonReadErr.message });
      }

      const usedCount = anonRow?.used_count ?? 0;
      if (usedCount >= 1) {
        return res.status(403).json({
          error: "Free limit reached",
          message: "Bir rüya hakkını kullandın. Devam etmek için üyelik oluşturmalısın."
        });
      }

      if (!anonRow) {
        const { error: anonInsertErr } = await supabase
          .from("anon_usage")
          .insert({ anon_key: anonKey, used_count: 1 });
        if (anonInsertErr) {
          return res.status(500).json({ error: "anon_usage insert failed", detail: anonInsertErr.message });
        }
      } else {
        const { error: anonUpdateErr } = await supabase
          .from("anon_usage")
          .update({ used_count: usedCount + 1, updated_at: new Date().toISOString() })
          .eq("anon_key", anonKey);
        if (anonUpdateErr) {
          return res.status(500).json({ error: "anon_usage update failed", detail: anonUpdateErr.message });
        }
      }
    }

    // 2) Şimdilik "test yorum" (Claude sonraki adım)
    const resultTraditional = modeSelected === "traditional"
      ? "TEST: Geleneksel yorum yakında burada görünecek."
      : null;

    const resultInternal = modeSelected === "internal"
      ? "TEST: İçsel yansıtıcı yorum yakında burada görünecek."
      : null;

    // 3) Dream kaydı
    const { data: insertedDream, error: dreamInsertErr } = await supabase
      .from("dreams")
      .insert({
        user_id: userId,
        dream_text: dreamText,
        mode_selected: modeSelected,
        result_traditional: resultTraditional,
        result_internal: resultInternal
      })
      .select("id, created_at")
      .single();

    if (dreamInsertErr) {
      return res.status(500).json({ error: "dream insert failed", detail: dreamInsertErr.message });
    }

    return res.status(200).json({
      ok: true,
      dreamId: insertedDream.id,
      createdAt: insertedDream.created_at,
      modeSelected,
      interpretation:
        modeSelected === "traditional" ? resultTraditional : resultInternal
    });

  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: e?.message || String(e) });
  }
}
