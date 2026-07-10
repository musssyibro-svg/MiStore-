// supabase/functions/bikes/index.ts
//
// Real Supabase Edge Function (Deno.serve), replacing the old products.ts-style
// stub that used req.query/res.status() (a Node/Express shape that never ran
// on Supabase's Deno runtime). Deploy with:
//   supabase functions deploy bikes
//
// Routes (all relative to /functions/v1/bikes):
//   GET    ?id=<uuid>                 -> single bike incl. images
//   GET    ?q=&category_id=&status=&featured=&limit=&offset=  -> list/search
//   POST   { ...bike fields }         -> create (admin only)
//   PUT    ?id=<uuid>  { ...fields }  -> update (admin only)
//   DELETE ?id=<uuid>                 -> delete, cascades to bike_images (admin only)
//
// GET is public (RLS already allows anonymous select) so the storefront can
// call this directly instead of reading assets/bikes/data/products.json.
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { adminClient, verifyAdmin } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const url = new URL(req.url);
  const method = req.method;

  try {
    if (method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        const { data: bike, error } = await adminClient
          .from("bikes")
          .select("*, bike_categories(id,name,slug)")
          .eq("id", id)
          .single();
        if (error || !bike) return json({ error: "not found" }, 404);

        const { data: images } = await adminClient
          .from("bike_images")
          .select("*")
          .eq("bike_id", id)
          .order("position", { ascending: true });

        return json({ ...bike, images: images || [] });
      }

      const q = url.searchParams.get("q");
      const categoryId = url.searchParams.get("category_id");
      const status = url.searchParams.get("status");
      const featured = url.searchParams.get("featured");
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
      const offset = Number(url.searchParams.get("offset") || 0);

      let query = adminClient
        .from("bikes")
        .select("*, bike_categories(id,name,slug), bike_images(id,storage_bucket,storage_path,is_cover,position)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (q) query = query.or(`name.ilike.%${q}%,model.ilike.%${q}%,supplier.ilike.%${q}%,sku.ilike.%${q}%`);
      if (categoryId) query = query.eq("category_id", categoryId);
      if (status) query = query.eq("status", status);
      if (featured === "true") query = query.eq("featured", true);

      const { data, error, count } = await query;
      if (error) return json({ error: error.message }, 500);
      return json({ bikes: data, count });
    }

    // Everything below mutates data -> require an authenticated admin session.
    await verifyAdmin(req);

    if (method === "POST") {
      const payload = await req.json();
      delete payload.id;
      delete payload.images; // images are managed via /bike-images
      const { data, error } = await adminClient.from("bikes").insert([payload]).select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data, 201);
    }

    if (method === "PUT" || method === "PATCH") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const payload = await req.json();
      delete payload.id;
      delete payload.images;
      const { data, error } = await adminClient.from("bikes").update(payload).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);

      // Clean up storage objects for every image belonging to this bike first
      // (bike_images rows cascade automatically via FK, but storage objects don't).
      const { data: images } = await adminClient.from("bike_images").select("storage_bucket,storage_path").eq("bike_id", id);
      if (images && images.length) {
        const byBucket = new Map<string, string[]>();
        for (const img of images) {
          const list = byBucket.get(img.storage_bucket) || [];
          list.push(img.storage_path);
          byBucket.set(img.storage_bucket, list);
        }
        for (const [bucket, paths] of byBucket) {
          await adminClient.storage.from(bucket).remove(paths).catch(() => null);
        }
      }

      const { error } = await adminClient.from("bikes").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    if (err?.name === "UnauthorizedError") return json({ error: "unauthorized" }, 401);
    console.error(err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
