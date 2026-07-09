-- 0004_admin_images.up.sql
-- Add images/assets table to support the image manager (uploads, variants, thumbnails, ordering)

CREATE TABLE IF NOT EXISTS images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  storage_bucket text DEFAULT 'catalog-photos',
  storage_path text NOT NULL,
  filename text,
  mime text,
  filesize integer,
  width integer,
  height integer,
  variants jsonb DEFAULT '[]'::jsonb, -- array of generated derivative objects {type, path, width, height, size}
  position integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_product_id ON images(product_id);
CREATE INDEX IF NOT EXISTS idx_images_collection_id ON images(collection_id);
CREATE INDEX IF NOT EXISTS idx_images_storage_path ON images(storage_path);
