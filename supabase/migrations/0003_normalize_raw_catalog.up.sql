-- 0003_normalize_raw_catalog.up.sql
-- Normalize raw_catalog JSON (from raw_catalog_backup) into categories, products, and product_variants
-- Idempotent: skips existing entries by slug and uses metadata->>'source'='raw_catalog_migration' to mark inserted rows
-- Preserves every model name, storage and price exactly. Deterministic slugs only.

DO $$
DECLARE
  rc jsonb;
  brand text;
  cond text;
  model text;
  variants jsonb;
  cat_slug text;
  prod_slug text;
  cat_id uuid;
  prod_id uuid;
  v jsonb;
  storage text;
  price_text text;
  price int;
BEGIN
  -- load latest raw catalog backup
  SELECT data INTO rc FROM raw_catalog_backup ORDER BY id DESC LIMIT 1;
  IF rc IS NULL THEN
    RAISE EXCEPTION 'raw_catalog_backup is empty; cannot normalize';
  END IF;

  -- iterate brands
  FOR brand IN SELECT key FROM jsonb_each(rc) LOOP
    -- iterate conditions inside brand
    FOR cond, _ IN SELECT key, value FROM jsonb_each(rc -> brand) LOOP
      -- deterministic category slug per brand+condition
      cat_slug := lower(regexp_replace(brand || '-' || cond, '[^a-z0-9]+', '-', 'g'));

      INSERT INTO categories (name, slug, metadata)
      VALUES (cond || ' (' || brand || ')', cat_slug, jsonb_build_object('brand', brand, 'condition', cond, 'source', 'raw_catalog_migration'))
      ON CONFLICT (slug) DO NOTHING;

      SELECT id INTO cat_id FROM categories WHERE slug = cat_slug;

      -- iterate models inside this condition
      FOR model, variants IN SELECT key, value FROM jsonb_each(rc -> brand -> cond) LOOP
        -- preserve model name exactly as 'name'
        prod_slug := lower(regexp_replace(brand || '-' || cond || '-' || model, '[^a-z0-9]+', '-', 'g'));

        INSERT INTO products (category_id, name, slug, metadata)
        VALUES (cat_id, model, prod_slug, jsonb_build_object('brand', brand, 'condition', cond, 'model', model, 'source', 'raw_catalog_migration'))
        ON CONFLICT (slug) DO NOTHING;

        SELECT id INTO prod_id FROM products WHERE slug = prod_slug;

        -- insert variants for this model (each variant is a 2-element array [storage, price])
        FOR v IN SELECT * FROM jsonb_array_elements(variants) LOOP
          -- v is a jsonb array like ["64",170200]
          storage := v ->> 0;
          price_text := v ->> 1;

          -- preserve price exactly, interpret as integer (do NOT round/convert)
          price := (price_text)::int;

          -- skip if a variant for this product with same storage already exists
          IF NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = prod_id AND (pv.attributes ->> 'storage') = storage) THEN
            INSERT INTO product_variants (product_id, sku, title, slug, attributes, price, currency, stock, metadata)
            VALUES (
              prod_id,
              prod_slug || '-' || storage,
              storage,
              lower(regexp_replace(prod_slug || '-' || storage, '[^a-z0-9]+', '-', 'g')),
              jsonb_build_object('storage', storage),
              price,
              'NGN',
              0,
              jsonb_build_object('brand', brand, 'condition', cond, 'model', model, 'storage', storage, 'source', 'raw_catalog_migration')
            );
          END IF;
        END LOOP; -- variants

      END LOOP; -- models
    END LOOP; -- conditions
  END LOOP; -- brands
END$$;

-- Update timestamps for inserted rows (optional)
UPDATE categories SET updated_at = now() WHERE (metadata ->> 'source') = 'raw_catalog_migration';
UPDATE products SET updated_at = now() WHERE (metadata ->> 'source') = 'raw_catalog_migration';
UPDATE product_variants SET updated_at = now() WHERE (metadata ->> 'source') = 'raw_catalog_migration';
