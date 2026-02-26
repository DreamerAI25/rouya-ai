import { createClient } from "@supabase/supabase-js";

const LIMITS = {
  free: { dreams: 3, images: 0 },
  plus: { dreams: 20, images: 10 },
  premium: { dreams: 50, images: 20 },
};

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
    // 1.5) Login kullanıcı için aylık limit kontrolü
    if (userId) {
      const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM

      // Profil var mı? yoksa oluştur
      let { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("plan, dreams_used_month, images_used_month, month_key")
        .eq("user_id", userId)
        .maybeSingle();

      if (profileErr) {
        return res.status(500).json({ error: "profiles read failed", detail: profileErr.message });
      }

      if (!profile) {
        // ilk kez login olan kullanıcı
        const { data: created, error: createErr } = await supabase
          .from("profiles")
          .insert({
            user_id: userId,
            plan: "free",
            dreams_used_month: 0,
            images_used_month: 0,
            month_key: monthKey,
            prefs: {}
          })
          .select("plan, dreams_used_month, images_used_month, month_key")
          .single();

        if (createErr) {
          return res.status(500).json({ error: "profiles insert failed", detail: createErr.message });
        }
        profile = created;
      }

      // Ay değiştiyse sayaçları sıfırla
      if (profile.month_key !== monthKey) {
        const { data: resetProfile, error: resetErr } = await supabase
          .from("profiles")
          .update({
            dreams_used_month: 0,
            images_used_month: 0,
            month_key: monthKey,
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId)
          .select("plan, dreams_used_month, images_used_month, month_key")
          .single();

        if (resetErr) {
          return res.status(500).json({ error: "profiles reset failed", detail: resetErr.message });
        }
        profile = resetProfile;
      }

      const plan = (profile.plan || "free").toLowerCase();
      const limits = LIMITS[plan] || LIMITS.free;

      if ((profile.dreams_used_month ?? 0) >= limits.dreams) {
        return res.status(403).json({
          error: "Monthly limit reached",
          message: `Bu ayki rüya hakkın doldu (${limits.dreams}). Plus veya Premium'a geçebilirsin.`,
          plan,
          limit: limits.dreams
        });
      }

      // hakkı düş
      const { error: incErr } = await supabase
        .from("profiles")
        .update({
          dreams_used_month: (profile.dreams_used_month ?? 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq("user_id", userId);

      if (incErr) {
        return res.status(500).json({ error: "profiles increment failed", detail: incErr.message });
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
