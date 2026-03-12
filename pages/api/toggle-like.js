import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey);
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
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const dreamId = (body.dreamId || "").toString().trim();

    const rawUserId = body.userId;
    const rawAnonKey = body.anonKey;

    const userId =
      rawUserId && rawUserId !== "null" && rawUserId !== "undefined"
        ? rawUserId.toString().trim()
        : null;

    const anonKey =
      rawAnonKey && rawAnonKey !== "null" && rawAnonKey !== "undefined"
        ? rawAnonKey.toString().trim()
        : null;

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId required" });
    }

    if (!userId && !anonKey) {
      return res.status(400).json({
        error: "Either userId or anonKey is required"
      });
    }

    const supabase = getSupabaseAdmin();

    // Önce dream gerçekten var mı kontrol et
    const { data: dreamRow, error: dreamCheckError } = await supabase
      .from("dreams")
      .select("id")
      .eq("id", dreamId)
      .maybeSingle();

    if (dreamCheckError) {
      return res.status(500).json({
        error: "Dream lookup failed",
        detail: dreamCheckError.message
      });
    }

    if (!dreamRow) {
      return res.status(404).json({
        error: "Dream not found",
        dreamId
      });
    }

    let existing = null;
    let existingError = null;

    if (userId) {
      const result = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("user_id", userId)
        .maybeSingle();

      existing = result.data;
      existingError = result.error;
    } else {
      const result = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("anon_key", anonKey)
        .maybeSingle();

      existing = result.data;
      existingError = result.error;
    }

    if (existingError) {
      return res.status(500).json({
        error: "Existing like lookup failed",
        detail: existingError.message
      });
    }

    let action = "liked";

    if (existing) {
      const { error: deleteError } = await supabase
        .from("dream_likes")
        .delete()
        .eq("id", existing.id);

      if (deleteError) {
        return res.status(500).json({
          error: "Delete like failed",
          detail: deleteError.message
        });
      }

      action = "unliked";
    } else {
      const insertPayload = {
        dream_id: dreamId,
        user_id: userId,
        anon_key: anonKey
      };

      const { data: insertedLike, error: insertError } = await supabase
        .from("dream_likes")
        .insert(insertPayload)
        .select("id, dream_id, user_id, anon_key")
        .single();

      if (insertError) {
        return res.status(500).json({
          error: "Insert like failed",
          detail: insertError.message,
          payload: insertPayload
        });
      }

      if (!insertedLike) {
        return res.status(500).json({
          error: "Insert returned no row"
        });
      }
    }

    const { count, error: countError } = await supabase
      .from("dream_likes")
      .select("*", { count: "exact", head: true })
      .eq("dream_id", dreamId);

    if (countError) {
      return res.status(500).json({
        error: "Count likes failed",
        detail: countError.message
      });
    }

    return res.status(200).json({
      ok: true,
      action,
      dreamId,
      likes: count || 0,
      liked: action === "liked"
    });

  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: e?.message || String(e)
    });
  }
}
