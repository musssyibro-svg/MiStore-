// supabase/functions/catalog-products/index.ts
//
// Handles smartwatches, power banks, speakers, earbuds -- any non-bike,
// non-phone product. Deploy with: supabase functions deploy catalog-products
//
// CRITICAL: the public GET path never returns rmb_price or profit_ngn. It
// returns only the computed `total` (and `unit_price` when sold_by_carton),
// per "customer should not see the real price just his total." Admin GET
// (with a valid session) gets the full breakdown for editing.
//
// Routes (relative to /functions/v1/catalog-products):
//   GET    ?id=<uuid>&shipping=sea|air|none          -> single product (public: price-safe; admin: full)
//   GET    ?category=<slug>&q=&limit=&offset=&shipping=sea|air|none  -> list (public: price-safe)
//   POST   { ...product, variants:[...] }            -> create (admin only)
//   PUT    ?id=<uuid> { ...fields, variants:[...] }  -> update (admin only)
//   DELETE ?id=<uuid>                                -> delete (admin only)
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { adminClient, verifyAdmin } from "../_shared/auth.ts";

async function getSettings() {
  const { data } = await adminClient.from("store_settings").select("*").eq("id", "default").single();
  return data || { exchange_rate: 208, sea_rate_per_cbm: 500000, air_rate_per_kg: 20000 };
}

function computeTotal(product: any, variant: any, settings: any, shipping: string) {
  const rmb = variant.rmb_price ?? 0;
  const converted = rmb * Number(settings.exchange_rate);
  const cbm = variant.cbm ?? product.cbm ?? 0;
  const weight = variant.weight_kg ?? product.weight_kg ?? 0;
  let shippingCost = 0;
  if (shipping === "sea") shippingCost = cbm * Number(settings.sea_rate_per_cbm);
  else if (shipping === "air") shippingCost = weight * Number(settings.air_rate_per_kg);
  const profit = variant.profit_ngn ?? 0;
  const total = converted + shippingCost + profit;
  const qtyPerCarton = variant.qty_per_carton ?? product.qty_per_carton ?? 1;
  const unitPrice = qtyPerCarton > 1 ? total / qtyPerCarton : null;
  return { shipping_cost: Math.round(shippingCost), total: Math.round(total), unit_price: unitPrice ? Math.round(unitPrice) : null };
}

// Strips supplier pricing, returns only what a customer should ever see.
function publicVariant(v: any, product: any, settings: any, shipping: string) {
  const priced = computeTotal(product, v, settings, shipping);
  return {
    id: v.id, spec1: v.spec1, spec2: v.spec2, variant_label: v.variant_label,
    sku: v.sku, stock: v.stock, moq: v.moq ?? product.moq,
    qty_per_carton: v.qty_per_carton ?? product.qty_per_carton,
    total: priced.total, unit_price: priced.unit_price,
  };
}

function publicProduct(p: any, settings: any, shipping: string) {
  return {
    id: p.id, name: p.name, slug: p.slug, brand: p.brand, description: p.description,
    moq: p.moq, sold_by_carton: p.sold_by_carton, qty_per_carton: p.qty_per_carton,
    featured: p.featured, category: p.catalog_categories?.name,
    images: (p.catalog_images || []).sort((a: any, b: any) => (a.position||0)-(b.position||0)),
    variants: (p.catalog_variants || []).sort((a:any,b:any)=>(a.position||0)-(b.position||0))
      .map((v: any) => publicVariant(v, p, settings, shipping)),
  };
}

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const url = new URL(req.url);
  const method = req.method;
  const shipping = url.searchParams.get("shipping") || "none"; // sea | air | none

  // Detect admin session (optional on GET -- unlocks full pricing detail).
  let isAdmin = false;
  try { await verifyAdmin(req); isAdmin = true; } catch (_e) { isAdmin = false; }

  try {
    if (method === "GET") {
      const settings = await getSettings();
      const id = url.searchParams.get("id");

      const selectCols = "*, catalog_categories(id,name,slug), catalog_variants(*), catalog_images(*)";

      if (id) {
        const { data, error } = await adminClient.from("catalog_products").select(selectCols).eq("id", id).single();
        if (error || !data) return json({ error: "not found" }, 404);
        return json(isAdmin ? data : publicProduct(data, settings, shipping));
      }

      const category = url.searchParams.get("category");
      const q = url.searchParams.get("q");
      const status = url.searchParams.get("status");
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
      const offset = Number(url.searchParams.get("offset") || 0);

      let query = adminClient.from("catalog_products").select(selectCols, { count: "exact" })
        .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (category) query = query.eq("catalog_categories.slug", category);
      if (q) query = query.or(`name.ilike.%${q}%,supplier_id.ilike.%${q}%`);
      if (status) query = query.eq("status", status);
      else if (!isAdmin) query = query.eq("status", "published"); // customers only see published items

      const { data, error, count } = await query;
      if (error) return json({ error: error.message }, 500);
      const items = isAdmin ? data : (data || []).map((p: any) => publicProduct(p, settings, shipping));
      return json({ products: items, count });
    }

    if (!isAdmin) return json({ error: "unauthorized" }, 401);

    if (method === "POST") {
      const body = await req.json();
      const { variants, ...product } = body;
      const { data: created, error } = await adminClient.from("catalog_products").insert([product]).select().single();
      if (error) return json({ error: error.message }, 400);
      if (Array.isArray(variants) && variants.length) {
        const rows = variants.map((v: any, i: number) => ({ ...v, product_id: created.id, position: v.position ?? i }));
        const { error: vErr } = await adminClient.from("catalog_variants").insert(rows);
        if (vErr) return json({ error: vErr.message }, 400);
      }
      return json(created, 201);
    }

    if (method === "PUT" || method === "PATCH") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const body = await req.json();
      const { variants, ...product } = body;
      delete product.id;
      const { data: updated, error } = await adminClient.from("catalog_products").update(product).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 400);

      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (v.id) {
            const { id: vid, ...vFields } = v;
            await adminClient.from("catalog_variants").update(vFields).eq("id", vid);
          } else {
            await adminClient.from("catalog_variants").insert([{ ...v, product_id: id }]);
          }
        }
      }
      return json(updated);
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);

      const { data: images } = await adminClient.from("catalog_images").select("storage_bucket,storage_path").eq("product_id", id);
      if (images && images.length) {
        const byBucket = new Map<string, string[]>();
        for (const img of images) {
          const list = byBucket.get(img.storage_bucket) || [];
          list.push(img.storage_path);
          byBucket.set(img.storage_bucket, list);
        }
        for (const [bucket, paths] of byBucket) await adminClient.storage.from(bucket).remove(paths).catch(() => null);
      }
      const { error } = await adminClient.from("catalog_products").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
