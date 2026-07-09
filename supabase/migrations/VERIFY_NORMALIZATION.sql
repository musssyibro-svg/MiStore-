-- VERIFY_NORMALIZATION.sql
-- Run these queries after applying 0003_normalize_raw_catalog.up.sql to verify counts

-- 0) Brand count expected (number of top-level keys in RAW_CATALOG)
WITH rc AS (
  SELECT data FROM raw_catalog_backup ORDER BY id DESC LIMIT 1
),
brands AS (
  SELECT key AS brand FROM rc, jsonb_each(rc.data)
)
SELECT count(*) AS expected_brands FROM brands;

-- 1) Expected counts derived from the raw_catalog_backup (latest row)
WITH rc AS (
  SELECT data FROM raw_catalog_backup ORDER BY id DESC LIMIT 1
),
-- cond_models enumerates one row per brand+condition
cond_models AS (
  SELECT b.key AS brand, c.key AS condition, c.value AS models
  FROM rc
  JOIN LATERAL jsonb_each(rc.data) b(key, value) ON true
  JOIN LATERAL jsonb_each(b.value) c(key, value) ON true
),
model_rows AS (
  SELECT brand, condition, key AS model, value AS variants
  FROM cond_models, LATERAL jsonb_each(cond_models.models)
)
SELECT
  (SELECT count(*) FROM (SELECT DISTINCT brand, condition FROM cond_models) x) AS expected_categories, -- distinct brand+condition
  (SELECT count(*) FROM model_rows) AS expected_products,
  (SELECT sum(jsonb_array_length(variants)) FROM model_rows) AS expected_variants;

-- 2) Actual counts inserted by migration (marked with metadata->>'source' = 'raw_catalog_migration')
SELECT
  (SELECT count(*) FROM categories WHERE (metadata ->> 'source') = 'raw_catalog_migration') AS actual_categories,
  (SELECT count(*) FROM products WHERE (metadata ->> 'source') = 'raw_catalog_migration') AS actual_products,
  (SELECT count(*) FROM product_variants WHERE (metadata ->> 'source') = 'raw_catalog_migration') AS actual_variants;

-- 3) Quick mismatch check: show any models that have different variant counts than expected
WITH rc AS (
  SELECT data FROM raw_catalog_backup ORDER BY id DESC LIMIT 1
),
brand_cond_model AS (
  SELECT
    b.key AS brand,
    c.key AS condition,
    m.key AS model,
    jsonb_array_length(m.value) AS expected_variant_count,
    lower(regexp_replace(b.key || '-' || c.key || '-' || m.key, '[^a-z0-9]+', '-', 'g')) AS expected_slug
  FROM rc
  JOIN LATERAL jsonb_each(rc.data) b(key, value) ON true
  JOIN LATERAL jsonb_each(b.value) c(key, value) ON true
  JOIN LATERAL jsonb_each(c.value) m(key, value) ON true
),
actual_counts AS (
  SELECT p.slug, count(pv.*) AS actual_variant_count
  FROM products p
  LEFT JOIN product_variants pv ON pv.product_id = p.id
  WHERE (p.metadata ->> 'source') = 'raw_catalog_migration'
  GROUP BY p.slug
)
SELECT b.brand, b.condition, b.model, b.expected_variant_count, a.slug, a.actual_variant_count
FROM brand_cond_model b
LEFT JOIN actual_counts a ON a.slug = b.expected_slug
WHERE b.expected_variant_count IS DISTINCT FROM COALESCE(a.actual_variant_count, 0);
