-- 0013_product_media_and_images_relations.up.sql
-- Ensure foreign keys and helper constraints for images <-> product_media linking

ALTER TABLE images
  ADD COLUMN IF NOT EXISTS assigned_to_media_id uuid;

ALTER TABLE product_media
  ADD CONSTRAINT IF NOT EXISTS fk_media_image FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_images_assigned_media ON images(assigned_to_media_id);
