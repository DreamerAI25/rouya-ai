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
    const isPublic =
      body.is_public === true ||
      body.is_public === "true" ||
      body.is_public === 1 ||
      body.is_public === "1";

    if (!dreamId) {
      return res.status(400).json({ error: "dreamId is required" });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("dreams")
      .update({ is_public: isPublic })
      .eq("id", dreamId)
      .select("id, is_public")
      .single();

    if (error) {
      return res.status(500).json({ error: "Update failed", detail: error.message });
    }

    return res.status(200).json({
      ok: true,
      dreamId: data.id,
      is_public: data.is_public,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: e?.message || String(e) });
  }
}
