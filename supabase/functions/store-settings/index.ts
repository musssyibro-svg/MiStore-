// supabase/functions/store-settings/index.ts
// Single source of truth for exchange rate + shipping rates, used by every
// product's price computation (bikes' bike_config is separate on purpose --
// bikes were already live before this schema existed; this one covers the
// new generic catalog). Deploy with: supabase functions deploy store-settings
//
// GET  -> current settings (public)
// PUT  { exchange_rate?, sea_rate_per_cbm?, air_rate_per_kg? } -> update (admin only)
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { adminClient, verifyAdmin } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    if (req.method === "GET") {
      const { data, error } = await adminClient.from("store_settings").select("*").eq("id", "default").single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      await verifyAdmin(req);
      const body = await req.json();
      const allowed = ["exchange_rate", "sea_rate_per_cbm", "air_rate_per_kg"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (body[k] != null) update[k] = body[k];
      const { data, error } = await adminClient.from("store_settings").update(update).eq("id", "default").select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    if (err?.name === "UnauthorizedError") return json({ error: "unauthorized" }, 401);
    console.error(err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
