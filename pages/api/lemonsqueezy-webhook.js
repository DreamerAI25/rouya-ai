import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = hmac.update(rawBody).digest("hex");
  return digest === signature;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["x-signature"];
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return res.status(400).send("Missing signature or secret");
    }

    const valid = verifySignature(rawBody, signature, secret);

    if (!valid) {
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const eventName = event?.meta?.event_name;
    const customData = event?.meta?.custom_data || {};
    const userId = customData.userId || customData.user_id || null;
    const planFromCheckout = customData.plan || null;

    if (!userId) {
      return res.status(200).json({ ok: true, skipped: "No userId in custom data" });
    }

    let plan = "free";

    if (planFromCheckout === "plus") plan = "plus";
    if (planFromCheckout === "premium") plan = "premium";

    if (!planFromCheckout) {
      const productName = event?.data?.attributes?.product_name || "";
      if (productName.toLowerCase().includes("premium")) plan = "premium";
      else if (productName.toLowerCase().includes("plus")) plan = "plus";
    }

    if (eventName === "subscription_created" || eventName === "subscription_updated") {
      const { error } = await supabase
        .from("profiles")
        .update({ plan })
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: "Profile update failed", detail: error.message });
      }
    }

    if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
      const { error } = await supabase
        .from("profiles")
        .update({ plan: "free" })
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: "Profile downgrade failed", detail: error.message });
      }
    }

    return res.status(200).json({ ok: true, eventName, userId, plan });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
