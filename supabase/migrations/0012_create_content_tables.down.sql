-- 0012_create_content_tables.down.sql
-- Rollback content tables
DROP INDEX IF EXISTS idx_homepage_blocks_pos;
DROP INDEX IF EXISTS idx_collection_items_collection;
DROP INDEX IF EXISTS idx_product_media_product;
DROP INDEX IF EXISTS idx_product_specs_product;

DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS homepage_blocks;
DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS product_specs;
