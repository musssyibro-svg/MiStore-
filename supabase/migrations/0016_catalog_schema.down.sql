-- 0016_catalog_schema.down.sql
DROP TRIGGER IF EXISTS trg_catalog_variants_updated_at ON catalog_variants;
DROP TRIGGER IF EXISTS trg_catalog_products_updated_at ON catalog_products;
DROP POLICY IF EXISTS "catalog_photos_admin_write" ON storage.objects;
DROP POLICY IF EXISTS "catalog_photos_public_read" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'catalog-photos';
DROP TABLE IF EXISTS catalog_images;
DROP TABLE IF EXISTS catalog_variants;
DROP TABLE IF EXISTS catalog_products;
DROP TABLE IF EXISTS catalog_categories;
DROP TABLE IF EXISTS store_settings;
