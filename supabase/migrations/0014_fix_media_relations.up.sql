-- 0014_fix_media_relations.up.sql
-- REPAIR migration. Fixes two real bugs from 0012/0013:
--
-- Bug 1: 0001_create_tables.up.sql already created `product_media` with columns
--        (product_id, url, type, position, metadata). 0012 tried to redefine
--        product_media with a different shape (variant_id, image_id, media_type,
--        title) using `CREATE TABLE IF NOT EXISTS`, which silently does nothing
--        because the table already existed. Result: image_id/variant_id/media_type
--        never got created.
--
-- Bug 2: 0013 then ran
--          ALTER TABLE product_media ADD CONSTRAINT IF NOT EXISTS fk_media_image ...
--        `ADD CONSTRAINT IF NOT EXISTS` is not valid PostgreSQL syntax at all
--        (IF NOT EXISTS is not supported on ADD CONSTRAINT), so this statement
--        would fail migration_run outright the first time it was actually applied.
--
-- This migration is idempotent and safe to run whether or not 0012/0013 partially
-- applied in your database already.

-- 1) Make sure product_media has the columns the rest of the app expects.
ALTER TABLE product_media ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE product_media ADD COLUMN IF NOT EXISTS image_id   uuid REFERENCES images(id) ON DELETE SET NULL;
ALTER TABLE product_media ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE product_media ADD COLUMN IF NOT EXISTS title      text;

-- Backfill media_type from the legacy `type` column (present since 0001) so existing rows
-- don't end up with a NULL media_type.
UPDATE product_media SET media_type = COALESCE(media_type, type, 'image') WHERE media_type IS NULL;

-- 2) Add the foreign key the correct way: check pg_constraint first instead of using
--    the invalid "ADD CONSTRAINT IF NOT EXISTS" syntax.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_media_image'
  ) THEN
    ALTER TABLE product_media
      ADD CONSTRAINT fk_media_image FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 3) images.assigned_to_media_id was added in 0013 but never indexed/constrained beyond
--    the index. Leave as-is (nullable, informational) but make sure the index exists.
CREATE INDEX IF NOT EXISTS idx_images_assigned_media ON images(assigned_to_media_id);
CREATE INDEX IF NOT EXISTS idx_product_media_image ON product_media(image_id);
CREATE INDEX IF NOT EXISTS idx_product_media_variant ON product_media(variant_id);
