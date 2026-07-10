#!/usr/bin/env node
// scripts/import-bikes.mjs
//
// One-time migration: reads assets/bikes/data/{products.json,categories.json,config.json}
// and the image files under assets/bikes/images/, uploads the images to the
// `bike-photos` Supabase Storage bucket, and inserts rows into bike_categories,
// bikes, bike_images, and bike_config.
//
// Run this ONCE, after applying migrations 0014 and 0015, and before you start
// using the new Bikes admin tab. It does not touch or delete the JSON files.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/import-bikes.mjs
//
// Requires: npm install @supabase/supabase-js
//
// Safe to re-run: bikes are matched/upserted by legacy_id (the original
// products.json "id" field, e.g. "KU-MOTO-001"), and images already uploaded
// for a bike are skipped on re-run (checked by original relative path stored
// in metadata.source_path).

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.");
  process.exit(1);
}

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "assets/bikes/data");
const IMAGES_DIR = path.join(ROOT, "assets/bikes/images");
const BUCKET = "bike-photos";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function upsertCategories(categoriesJson) {
  const slugToId = {};
  const active = categoriesJson.active || [];
  let position = 0;
  for (const cat of active) {
    const slug = cat.id || slugify(cat.name);
    const { data, error } = await sb
      .from("bike_categories")
      .upsert(
        { name: cat.name, slug, position: position++, metadata: { suppliers: cat.suppliers || [] } },
        { onConflict: "slug" },
      )
      .select()
      .single();
    if (error) throw error;
    slugToId[slug] = data.id;

    for (const sub of cat.subcategories || []) {
      const subSlug = sub.id || slugify(`${cat.name}-${sub.name}`);
      const { data: subData, error: subErr } = await sb
        .from("bike_categories")
        .upsert(
          { name: sub.name, slug: subSlug, parent_id: data.id, position: 0, metadata: { suppliers: sub.suppliers || [] } },
          { onConflict: "slug" },
        )
        .select()
        .single();
      if (subErr) throw subErr;
      slugToId[subSlug] = subData.id;
    }
  }
  return slugToId;
}

async function upsertConfig(configJson) {
  const { error } = await sb.from("bike_config").upsert(
    {
      id: "default",
      shipping_per_cbm_ngn: configJson.shipping_per_cbm_ngn,
      logistics_service_ngn: configJson.logistics_ngn ?? configJson.logistics_service_ngn,
      rmb_to_ngn: configJson.rmb_to_ngn,
      usd_to_rmb: configJson.usd_to_rmb ?? (configJson.usd_to_ngn && configJson.rmb_to_ngn ? configJson.usd_to_ngn / configJson.rmb_to_ngn : 7.2),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

function categorySlugFor(product) {
  // categories.json only defines two top-level active categories; map by product.category text.
  if (/motorcycle/i.test(product.category)) return "e-motorcycles";
  if (/bike/i.test(product.category)) return "e-bikes";
  return null;
}

async function uploadImageIfNeeded(bikeId, relativePath, isFirst) {
  const abs = path.join(IMAGES_DIR, relativePath);
  if (!fs.existsSync(abs)) {
    console.warn(`  ! missing image file, skipping: ${relativePath}`);
    return null;
  }

  const { data: existing } = await sb
    .from("bike_images")
    .select("id")
    .eq("bike_id", bikeId)
    .contains("metadata", { source_path: relativePath })
    .maybeSingle();
  if (existing) return existing.id; // already imported

  const bytes = fs.readFileSync(abs);
  const ext = path.extname(abs) || ".jpg";
  const storagePath = `bikes/${bikeId}/import-${Date.now()}-${slugify(path.basename(abs, ext))}${ext}`;
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, bytes, { contentType: mime, upsert: true });
  if (upErr) throw upErr;

  const { data: existingCover } = await sb.from("bike_images").select("id").eq("bike_id", bikeId).eq("is_cover", true).maybeSingle();
  const { data: posRows } = await sb.from("bike_images").select("position").eq("bike_id", bikeId).order("position", { ascending: false }).limit(1);
  const nextPos = posRows && posRows.length ? posRows[0].position + 1 : 0;

  const { data, error } = await sb
    .from("bike_images")
    .insert([{
      bike_id: bikeId,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      filename: path.basename(abs),
      mime,
      filesize: bytes.length,
      is_cover: isFirst && !existingCover,
      position: nextPos,
      metadata: { source: "json_import", source_path: relativePath },
    }])
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

async function main() {
  const products = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "products.json"), "utf8"));
  const categories = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "categories.json"), "utf8"));
  const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8"));

  console.log(`Importing bike_config...`);
  await upsertConfig(config);

  console.log(`Importing bike_categories...`);
  const slugToId = await upsertCategories(categories);

  const items = products.products || [];
  console.log(`Importing ${items.length} bikes...`);

  let created = 0, updated = 0, imagesUploaded = 0;

  for (const p of items) {
    const catSlug = categorySlugFor(p);
    const categoryId = catSlug ? slugToId[catSlug] : null;
    const slug = slugify(`${p.supplier}-${p.model}-${p.id}`);

    const specs = {
      motor: p.motor, battery_type: p.battery_type, voltage: p.voltage,
      top_speed: p.top_speed, range: p.range, wheel_size: p.wheel_size,
      brake: p.brake, weight: p.weight, max_load: p.max_load,
      dimension: p.dimension, packing_size: p.packing_size, colors: p.colors,
    };

    const row = {
      legacy_id: p.id,
      name: `${p.supplier} ${p.model}`.trim(),
      slug,
      model: p.model,
      supplier: p.supplier,
      category_id: categoryId,
      fob_price: p.fob_price ?? null,
      fob_price_high: p.fob_price_high ?? null,
      fob_currency: p.currency || "USD",
      cbm: p.cbm ?? null,
      cbm_source: p.cbm_source || null,
      customer_price_ngn: p.customer_price_ngn ?? null,
      price_breakdown: p.price_breakdown || {},
      qty_20fcl: p.qty_20fcl ?? null,
      qty_40hq: p.qty_40hq ?? null,
      availability: p.availability || "in_stock",
      specs,
      features: p.features || [],
      motor_upgrades: p.motor_upgrades || [],
      battery_price_map: p.battery_price_map || [],
      accessory_options: p.accessory_options || [],
      included_in_fob: p.included_in_fob || [],
      price_ladder: p.price_ladder || [],
      data_confidence: p.data_confidence || null,
      duplicate_group: p.duplicate_group || null,
      is_primary: p.is_primary !== false,
      group_size: p.group_size || 1,
      status: "published",
      metadata: { subcategory: p.subcategory || null, imported_from: "assets/bikes/data/products.json" },
    };

    const { data: existing } = await sb.from("bikes").select("id").eq("legacy_id", p.id).maybeSingle();
    let bikeId;
    if (existing) {
      const { data, error } = await sb.from("bikes").update(row).eq("id", existing.id).select().single();
      if (error) throw error;
      bikeId = data.id;
      updated++;
    } else {
      const { data, error } = await sb.from("bikes").insert([row]).select().single();
      if (error) throw error;
      bikeId = data.id;
      created++;
    }

    const images = (p.images && p.images.length ? p.images : (p.image ? [p.image] : []));
    for (let i = 0; i < images.length; i++) {
      const id = await uploadImageIfNeeded(bikeId, images[i], i === 0);
      if (id) imagesUploaded++;
    }
  }

  console.log(`Done. Bikes created: ${created}, updated: ${updated}, images processed: ${imagesUploaded}.`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
