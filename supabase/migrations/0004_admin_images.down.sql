-- 0004_admin_images.down.sql
-- Rollback for images table
DROP INDEX IF EXISTS idx_images_storage_path;
DROP INDEX IF EXISTS idx_images_collection_id;
DROP INDEX IF EXISTS idx_images_product_id;
DROP TABLE IF EXISTS images;
