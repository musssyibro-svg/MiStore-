-- 0015_bikes_schema.down.sql
DROP TRIGGER IF EXISTS trg_bike_images_updated_at ON bike_images;
DROP TRIGGER IF EXISTS trg_bikes_updated_at ON bikes;

DROP POLICY IF EXISTS "bike_photos_admin_write" ON storage.objects;
DROP POLICY IF EXISTS "bike_photos_public_read" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'bike-photos';

DROP TABLE IF EXISTS bike_images;
DROP TABLE IF EXISTS bikes;
DROP TABLE IF EXISTS bike_categories;
DROP TABLE IF EXISTS bike_config;
