-- CATALOG_SETUP.sql  —  paste this whole file into Supabase → SQL Editor → Run.
-- Creates the "accessories" catalog (smart watches, power banks, speakers,
-- earbuds, kitchen, and anything else that isn't a bike or a phone) so the
-- Accessories tab in admin.html can manage it directly — no computer, no CLI,
-- no edge functions. Safe to run more than once (idempotent).

-- Shared updated_at trigger function (also created by BIKES_SETUP.sql — harmless to redefine).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- store_settings: one row that drives every catalog price (¥→₦ + shipping).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_settings (
  id text PRIMARY KEY,
  exchange_rate numeric NOT NULL DEFAULT 208,
  sea_rate_per_cbm numeric NOT NULL DEFAULT 500000,
  air_rate_per_kg numeric NOT NULL DEFAULT 20000,
  default_profit_pct numeric NOT NULL DEFAULT 15,   -- temporary margin for goods with no explicit profit
  updated_at timestamptz DEFAULT now()
);
-- for installs created before this column existed:
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS default_profit_pct numeric NOT NULL DEFAULT 15;
INSERT INTO store_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- catalog_categories: sections shown in the store.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  position integer DEFAULT 0,
  featured boolean DEFAULT false,
  hidden boolean DEFAULT false,
  icon text,                              -- emoji shown in the store section header
  metadata jsonb DEFAULT '{}'::jsonb,     -- { fields:[{key,label,type}] } custom spec schema, editable in admin
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- for installs created before these columns existed:
ALTER TABLE catalog_categories ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE catalog_categories ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

INSERT INTO catalog_categories (name, slug, position, icon) VALUES
  ('Smart Watches', 'smartwatch', 1, '⌚'),
  ('Power Banks', 'powerbank', 2, '🔋'),
  ('Speakers', 'speaker', 3, '🔊'),
  ('Earbuds', 'earphone', 4, '🎧'),
  ('Kitchen Appliances', 'kitchen-appliances', 5, '🍳'),
  ('Kitchen Utensils', 'kitchen-utensils', 6, '🍴'),
  ('Electronics', 'electronics', 7, '💡'),
  ('Laptops', 'laptops', 8, '💻')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- catalog_products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  supplier_id text,
  name text NOT NULL,
  slug text UNIQUE,
  brand text,
  supplier text DEFAULT 'Aifei Commodity Co.,Ltd',
  description text,
  moq integer DEFAULT 100,
  qty_per_carton integer DEFAULT 1,
  sold_by_carton boolean DEFAULT false,
  weight_kg numeric,
  cbm numeric,
  stock integer DEFAULT 0,
  featured boolean DEFAULT false,
  show_on_homepage boolean DEFAULT false,
  status text DEFAULT 'draft',
  price_from_ngn numeric,       -- customer-facing "from" price (computed in admin; NO supplier cost)
  seo jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON catalog_products(category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_supplier_id ON catalog_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_status ON catalog_products(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_products_supplier_cat ON catalog_products(supplier_id, category_id);
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS price_from_ngn numeric;   -- for older installs

-- ---------------------------------------------------------------------------
-- catalog_variants: color/capacity/spec combos, each independently priced.
-- rmb_price / profit_ngn are supplier-side only — never shown to customers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  spec1 text,
  spec2 text,
  variant_label text,
  sku text,
  rmb_price numeric,
  profit_ngn numeric,
  moq integer,
  qty_per_carton integer,
  weight_kg numeric,
  cbm numeric,
  stock integer DEFAULT 0,
  position integer DEFAULT 0,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_variants_product ON catalog_variants(product_id);

-- ---------------------------------------------------------------------------
-- catalog_images
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES catalog_variants(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'catalog-photos',
  storage_path text NOT NULL,
  filename text,
  mime text,
  filesize integer,
  width integer,
  height integer,
  is_cover boolean DEFAULT false,
  position integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_images_product ON catalog_images(product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_images_variant ON catalog_images(variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_images_one_cover ON catalog_images(product_id) WHERE is_cover = true;

-- ---------------------------------------------------------------------------
-- Row Level Security — public read, authenticated-admin write (same as bikes).
-- ---------------------------------------------------------------------------
ALTER TABLE store_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_variants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_images      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_settings_public_read" ON store_settings;
CREATE POLICY "store_settings_public_read" ON store_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "store_settings_admin_write" ON store_settings;
CREATE POLICY "store_settings_admin_write" ON store_settings FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "catalog_categories_public_read" ON catalog_categories;
CREATE POLICY "catalog_categories_public_read" ON catalog_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "catalog_categories_admin_write" ON catalog_categories;
CREATE POLICY "catalog_categories_admin_write" ON catalog_categories FOR ALL USING (auth.uid() IS NOT NULL);

-- Admin (authenticated) can do everything, including read supplier pricing.
DROP POLICY IF EXISTS "catalog_products_admin_all" ON catalog_products;
CREATE POLICY "catalog_products_admin_all" ON catalog_products FOR ALL USING (auth.uid() IS NOT NULL);
-- Customers may read ONLY published products, and only safe columns exist here
-- (name, price_from_ngn, images) — supplier ¥ pricing lives in catalog_variants,
-- which stays admin-only below, so it can never be read by the storefront.
DROP POLICY IF EXISTS "catalog_products_public_read" ON catalog_products;
CREATE POLICY "catalog_products_public_read" ON catalog_products FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "catalog_variants_admin_all" ON catalog_variants;
CREATE POLICY "catalog_variants_admin_all" ON catalog_variants FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "catalog_images_public_read" ON catalog_images;
CREATE POLICY "catalog_images_public_read" ON catalog_images FOR SELECT USING (true);
DROP POLICY IF EXISTS "catalog_images_admin_write" ON catalog_images;
CREATE POLICY "catalog_images_admin_write" ON catalog_images FOR ALL USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Storage bucket for catalog photos.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalog-photos', 'catalog-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "catalog_photos_public_read" ON storage.objects;
CREATE POLICY "catalog_photos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'catalog-photos');
DROP POLICY IF EXISTS "catalog_photos_admin_write" ON storage.objects;
CREATE POLICY "catalog_photos_admin_write" ON storage.objects
  FOR ALL USING (bucket_id = 'catalog-photos' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'catalog-photos' AND auth.uid() IS NOT NULL);

-- keep updated_at fresh
DROP TRIGGER IF EXISTS trg_catalog_products_updated_at ON catalog_products;
CREATE TRIGGER trg_catalog_products_updated_at BEFORE UPDATE ON catalog_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_catalog_variants_updated_at ON catalog_variants;
CREATE TRIGGER trg_catalog_variants_updated_at BEFORE UPDATE ON catalog_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_catalog_images_updated_at ON catalog_images;
CREATE TRIGGER trg_catalog_images_updated_at BEFORE UPDATE ON catalog_images
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
