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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const dreamId = (req.query.dreamId || "").toString().trim();

    const rawUserId = req.query.userId;
    const rawAnonKey = req.query.anonKey;

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

    const supabase = getSupabaseAdmin();

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

    let liked = false;

    if (userId) {
      const { data, error } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "User like lookup failed",
          detail: error.message
        });
      }

      liked = !!data;
    } else if (anonKey) {
      const { data, error } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("anon_key", anonKey)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: "Anon like lookup failed",
          detail: error.message
        });
      }

      liked = !!data;
    }

    return res.status(200).json({
      ok: true,
      dreamId,
      likes: count || 0,
      liked
    });

  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: e?.message || String(e)
    });
  }
}
