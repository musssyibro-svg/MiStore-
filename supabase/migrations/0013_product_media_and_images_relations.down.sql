-- 0013_product_media_and_images_relations.down.sql
DROP INDEX IF EXISTS idx_images_assigned_media;
ALTER TABLE product_media DROP CONSTRAINT IF EXISTS fk_media_image;
ALTER TABLE images DROP COLUMN IF EXISTS assigned_to_media_id;
