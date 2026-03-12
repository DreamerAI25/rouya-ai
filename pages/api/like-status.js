import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    const userId = req.query.userId || null;
    const anonKey = req.query.anonKey || null;

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId required" });
    }

    const supabase = getSupabaseAdmin();

    const { count } = await supabase
      .from("dream_likes")
      .select("*", { count: "exact", head: true })
      .eq("dream_id", dreamId);

    let liked = false;

    if (userId) {
      const { data } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("user_id", userId)
        .maybeSingle();

      liked = !!data;
    } else if (anonKey) {
      const { data } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("anon_key", anonKey)
        .maybeSingle();

      liked = !!data;
    }

    return res.status(200).json({
      ok: true,
      likes: count || 0,
      liked
    });

  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: e.message
    });
  }
}
