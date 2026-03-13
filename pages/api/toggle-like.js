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
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const dreamId = String(body.dreamId || "").trim();

    const rawUserId = body.userId;
    const rawAnonKey = body.anonKey;

    const userId =
      rawUserId && rawUserId !== "null" && rawUserId !== "undefined"
        ? String(rawUserId).trim()
        : null;

    const anonKey =
      rawAnonKey && rawAnonKey !== "null" && rawAnonKey !== "undefined"
        ? String(rawAnonKey).trim()
        : null;

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId required" });
    }

    if (!userId && !anonKey) {
      return res.status(400).json({
        error: "Either userId or anonKey is required",
      });
    }

    const supabase = getSupabaseAdmin();

    const { data: dreamRow, error: dreamError } = await supabase
      .from("dreams")
      .select("id")
      .eq("id", dreamId)
      .maybeSingle();

    if (dreamError) {
      return res.status(500).json({
        error: "Dream lookup failed",
        detail: dreamError.message,
      });
    }

    if (!dreamRow) {
      const { data: sampleDreams, error: sampleError } = await supabase
        .from("dreams")
        .select("id")
        .limit(5);

      return res.status(404).json({
        error: "Dream not found",
        receivedDreamId: dreamId,
        sampleDreamIds: sampleError ? [] : sampleDreams || [],
      });
    }

    let existingLike = null;

    if (userId) {
      const { data, error } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Existing user like lookup failed",
          detail: error.message,
        });
      }

      existingLike = data;
    } else {
      const { data, error } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("anon_key", anonKey)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Existing anon like lookup failed",
          detail: error.message,
        });
      }

      existingLike = data;
    }

    let liked = false;
    let action = "liked";

    if (existingLike) {
      const { error: deleteError } = await supabase
        .from("dream_likes")
        .delete()
        .eq("id", existingLike.id);

      if (deleteError) {
        return res.status(500).json({
          error: "Delete like failed",
          detail: deleteError.message,
        });
      }

      liked = false;
      action = "unliked";
    } else {
      const insertPayload = {
        dream_id: dreamId,
        user_id: userId,
        anon_key: anonKey,
      };

      const { data: insertedLike, error: insertError } = await supabase
        .from("dream_likes")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) {
        return res.status(500).json({
          error: "Insert like failed",
          detail: insertError.message,
          payload: insertPayload,
        });
      }

      if (!insertedLike) {
        return res.status(500).json({
          error: "Insert returned no row",
        });
      }

      liked = true;
      action = "liked";
    }

    const { count, error: countError } = await supabase
      .from("dream_likes")
      .select("*", { count: "exact", head: true })
      .eq("dream_id", dreamId);

    if (countError) {
      return res.status(500).json({
        error: "Count likes failed",
        detail: countError.message,
      });
    }

    return res.status(200).json({
      ok: true,
      dreamId,
      action,
      liked,
      likes: count || 0,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: e?.message || String(e),
    });
  }
}
