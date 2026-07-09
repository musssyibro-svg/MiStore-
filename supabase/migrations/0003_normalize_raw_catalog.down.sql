-- 0003_normalize_raw_catalog.down.sql
-- Rollback for normalization: removes rows inserted by 0003_normalize_raw_catalog.up.sql
-- Deletes product_variants, products, and categories where metadata->>'source' = 'raw_catalog_migration'

BEGIN;

DELETE FROM product_variants WHERE (metadata ->> 'source') = 'raw_catalog_migration';
DELETE FROM products WHERE (metadata ->> 'source') = 'raw_catalog_migration';
DELETE FROM categories WHERE (metadata ->> 'source') = 'raw_catalog_migration';

COMMIT;
