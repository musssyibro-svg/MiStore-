-- 0001_create_tables.down.sql
-- Rollback for initial schema: drops the tables created in the up migration

DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS homepage_blocks;
DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS product_specs;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;

-- Note: Extension pgcrypto is left in place on rollback (safe to keep).