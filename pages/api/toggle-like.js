import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    const body = req.body || {};
    const dreamId = (body.dreamId || "").toString().trim();
    const userId = body.userId || null;
    const anonKey = body.anonKey || null;

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId required" });
    }

    const supabase = getSupabaseAdmin();

    let existing;

    if (userId) {
      const { data } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("user_id", userId)
        .maybeSingle();

      existing = data;

    } else if (anonKey) {

      const { data } = await supabase
        .from("dream_likes")
        .select("id")
        .eq("dream_id", dreamId)
        .eq("anon_key", anonKey)
        .maybeSingle();

      existing = data;
    }

    if (existing) {

      await supabase
        .from("dream_likes")
        .delete()
        .eq("id", existing.id);

    } else {

      await supabase
        .from("dream_likes")
        .insert({
          dream_id: dreamId,
          user_id: userId,
          anon_key: anonKey
        });
    }

    const { count } = await supabase
      .from("dream_likes")
      .select("*", { count: "exact", head: true })
      .eq("dream_id", dreamId);

    return res.status(200).json({
      ok: true,
      likes: count
    });

  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: e.message
    });
  }
}
