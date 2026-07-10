-- 0014_fix_media_relations.down.sql
ALTER TABLE product_media DROP CONSTRAINT IF EXISTS fk_media_image;
ALTER TABLE product_media DROP COLUMN IF EXISTS variant_id;
ALTER TABLE product_media DROP COLUMN IF EXISTS image_id;
ALTER TABLE product_media DROP COLUMN IF EXISTS media_type;
ALTER TABLE product_media DROP COLUMN IF EXISTS title;
