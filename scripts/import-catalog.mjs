#!/usr/bin/env node
// scripts/import-catalog.mjs
//
// Imports the products extracted from the supplier PDFs (smartwatch, power
// bank, speaker, earphone) into catalog_products / catalog_variants /
// catalog_images. Run this AFTER migrations 0014-0016 are applied.
//
// Expects to be run from a folder containing:
//   catalog-data/{smartwatch,powerbank,speaker,earphone}_products.json
//   catalog-images/images/{category}/*.png
// (i.e. unzip both mistore-catalog-data.zip and mistore-catalog-images.zip
// into the same parent folder before running this.)
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/import-catalog.mjs /path/to/unzipped/catalog
//
// Safe to re-run: products are upserted by (supplier_id, category), and
// variants/images are only created if they don't already exist for that
// product (matched by spec1+spec2 for variants, by source filename for images).

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const ROOT = process.argv[2] || process.cwd();
const BUCKET = "catalog-photos";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/(^-|-$)/g, "") || "item";
}

async function categoryId(slug) {
  const { data } = await sb.from("catalog_categories").select("id").eq("slug", slug).maybeSingle();
  return data ? data.id : null;
}

async function uploadImage(productId, relativeImagePath) {
  const abs = path.join(ROOT, relativeImagePath);
  if (!fs.existsSync(abs)) { console.warn(`  ! missing image: ${relativeImagePath}`); return null; }
  const bytes = fs.readFileSync(abs);
  const base = path.basename(abs);

  const { data: existing } = await sb.from("catalog_images").select("id").eq("product_id", productId)
    .contains("metadata", { source_file: base }).maybeSingle();
  if (existing) return existing.id;

  const storagePath = `catalog/${productId}/import-${Date.now()}-${slugify(base)}.png`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw upErr;

  const { data: existingCover } = await sb.from("catalog_images").select("id").eq("product_id", productId).eq("is_cover", true).maybeSingle();
  const { data: posRows } = await sb.from("catalog_images").select("position").eq("product_id", productId).order("position", { ascending: false }).limit(1);
  const nextPos = posRows?.length ? posRows[0].position + 1 : 0;

  const { data, error } = await sb.from("catalog_images").insert([{
    product_id: productId, storage_bucket: BUCKET, storage_path: storagePath,
    filename: base, mime: "image/png", filesize: bytes.length,
    is_cover: !existingCover, position: nextPos, metadata: { source: "pdf_import", source_file: base },
  }]).select().single();
  if (error) throw error;
  return data.id;
}

async function importCategory(cat) {
  const file = path.join(ROOT, "data", `${cat}_products.json`);
  if (!fs.existsSync(file)) { console.warn(`skip ${cat}: ${file} not found`); return; }
  const products = JSON.parse(fs.readFileSync(file, "utf8"));
  const catId = await categoryId(cat);

  let created = 0, updated = 0, variantsWritten = 0, imagesWritten = 0;

  for (const p of products) {
    const slug = slugify(`${cat}-${p.supplier_id}`);
    const row = {
      category_id: catId, supplier_id: p.supplier_id, category: cat,
      name: p.name_guess, slug, status: "draft", // draft until admin reviews/renames
      moq: p.variants[0]?.moq || 100,
      metadata: { imported_from: "pdf_catalog", category: cat },
    };
    delete row.category; // not a real column; category comes via category_id

    const { data: existing } = await sb.from("catalog_products").select("id").eq("supplier_id", p.supplier_id).eq("category_id", catId).maybeSingle();
    let productId;
    if (existing) {
      const { data, error } = await sb.from("catalog_products").update(row).eq("id", existing.id).select().single();
      if (error) throw error;
      productId = data.id; updated++;
    } else {
      const { data, error } = await sb.from("catalog_products").insert([row]).select().single();
      if (error) throw error;
      productId = data.id; created++;
    }

    for (let i = 0; i < p.variants.length; i++) {
      const v = p.variants[i];
      const { data: existingVariant } = await sb.from("catalog_variants").select("id").eq("product_id", productId)
        .eq("spec1", v.spec1 || "").eq("spec2", v.spec2 || "").maybeSingle();
      if (!existingVariant) {
        const { error } = await sb.from("catalog_variants").insert([{
          product_id: productId, spec1: v.spec1, spec2: v.spec2, variant_label: v.variant_label,
          rmb_price: v.rmb_price, moq: v.moq, position: i, is_default: i === 0,
        }]);
        if (error) throw error;
        variantsWritten++;
      }
      if (v.image) {
        const id = await uploadImage(productId, v.image);
        if (id) imagesWritten++;
      }
    }
  }
  console.log(`${cat}: ${created} created, ${updated} updated, ${variantsWritten} variants written, ${imagesWritten} images processed`);
}

async function main() {
  for (const cat of ["smartwatch", "powerbank", "speaker", "earphone"]) {
    await importCategory(cat);
  }
  console.log("Done. All products were imported as status='draft' -- review names/categories in the admin Catalog tab, then publish each.");
}

main().catch((err) => { console.error("Import failed:", err); process.exit(1); });
