-- 0016_catalog_schema.up.sql
-- Generic "accessories" catalog: smartwatches, power banks, speakers, earbuds,
-- and anything else that isn't a bike or an existing phone product. Built so
-- every field -- price, shipping, profit, MOQ, images -- is admin-editable,
-- with the pricing formula centralized in `store_settings` instead of typed
-- into every product.
--
-- PRICING FORMULA (matches MiStore's actual formula, computed live — nothing
-- here is pre-baked so changing store_settings updates every product at once):
--   converted_price   = rmb_price * store_settings.exchange_rate
--   sea_shipping       = cbm * store_settings.sea_rate_per_cbm       (optional, customer's choice)
--   air_shipping        = weight_kg * store_settings.air_rate_per_kg  (optional, customer's choice)
--   total               = converted_price + shipping (sea OR air OR none) + profit_ngn
--   unit_price          = total / qty_per_carton   (only meaningful when qty_per_carton > 1)
-- profit_ngn is per-variant and left NULL by default -- admin sets it per item,
-- exactly as requested ("profit should be blank for now").
-- The customer-facing storefront must only ever render `total` / `unit_price`,
-- never rmb_price or converted_price -- enforced in the edge function, not just the UI,
-- by never returning rmb_price on the public read (see catalog-products function).

-- ---------------------------------------------------------------------------
-- store_settings: single source of truth for exchange rate + shipping rates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_settings (
  id text PRIMARY KEY,
  exchange_rate numeric NOT NULL DEFAULT 208,       -- ¥ -> ₦
  sea_rate_per_cbm numeric NOT NULL DEFAULT 500000,  -- ₦ per CBM
  air_rate_per_kg numeric NOT NULL DEFAULT 20000,    -- ₦ per kg
  updated_at timestamptz DEFAULT now()
);
INSERT INTO store_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- catalog_categories: smartwatches / power banks / speakers / earbuds / etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  position integer DEFAULT 0,
  featured boolean DEFAULT false,
  hidden boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
INSERT INTO catalog_categories (name, slug, position) VALUES
  ('Smart Watches', 'smartwatch', 1),
  ('Power Banks', 'powerbank', 2),
  ('Speakers', 'speaker', 3),
  ('Earbuds', 'earphone', 4)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- catalog_products: one product = one supplier catalog entry (may have many
-- color/spec variants below).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  supplier_id text,             -- original supplier catalog id, e.g. "1752912"
  name text NOT NULL,
  slug text UNIQUE,
  brand text,
  supplier text DEFAULT 'Aifei Commodity Co.,Ltd',
  description text,
  moq integer DEFAULT 100,      -- minimum order quantity, editable per product
  qty_per_carton integer DEFAULT 1,
  sold_by_carton boolean DEFAULT false,
  weight_kg numeric,
  cbm numeric,
  stock integer DEFAULT 0,
  featured boolean DEFAULT false,
  show_on_homepage boolean DEFAULT false,
  status text DEFAULT 'draft',  -- draft | published | archived
  seo jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON catalog_products(category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_supplier_id ON catalog_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_status ON catalog_products(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_products_supplier_cat ON catalog_products(supplier_id, category_id);

-- ---------------------------------------------------------------------------
-- catalog_variants: color / capacity / spec combinations, each independently priced.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  spec1 text,                   -- e.g. color: 黑色
  spec2 text,                   -- e.g. capacity: 10000毫安（跨境款）
  variant_label text,           -- human display label, editable
  sku text,
  rmb_price numeric,            -- supplier price in ¥ -- NEVER exposed to customers
  profit_ngn numeric,           -- editable, per-variant, blank by default
  moq integer,                  -- overrides product.moq if set
  qty_per_carton integer,       -- overrides product.qty_per_carton if set
  weight_kg numeric,             -- overrides product.weight_kg if set
  cbm numeric,                   -- overrides product.cbm if set
  stock integer DEFAULT 0,
  position integer DEFAULT 0,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_variants_product ON catalog_variants(product_id);

-- ---------------------------------------------------------------------------
-- catalog_images: shared by product (general shots) or a specific variant
-- (e.g. the exact color photographed).
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
-- RLS: same pattern as bikes -- public read, authenticated-admin write.
-- rmb_price/profit_ngn are still subject to RLS-gated SELECT here, but the
-- real enforcement (never sending them to customers) happens in the
-- catalog-products edge function's public response shape, not just RLS,
-- since anon SELECT is intentionally allowed for the storefront to read
-- everything else (name, images, computed total once computed server-side).
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

-- catalog_products/variants: admin (authenticated) can read everything including
-- rmb_price/profit; anonymous access is intentionally NOT granted directly to
-- these tables -- the storefront must go through the catalog-products edge
-- function (service role), which strips supplier pricing before responding.
DROP POLICY IF EXISTS "catalog_products_admin_all" ON catalog_products;
CREATE POLICY "catalog_products_admin_all" ON catalog_products FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "catalog_variants_admin_all" ON catalog_variants;
CREATE POLICY "catalog_variants_admin_all" ON catalog_variants FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "catalog_images_public_read" ON catalog_images;
CREATE POLICY "catalog_images_public_read" ON catalog_images FOR SELECT USING (true);
DROP POLICY IF EXISTS "catalog_images_admin_write" ON catalog_images;
CREATE POLICY "catalog_images_admin_write" ON catalog_images FOR ALL USING (auth.uid() IS NOT NULL);

-- storage bucket for catalog photos
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

DROP TRIGGER IF EXISTS trg_catalog_products_updated_at ON catalog_products;
CREATE TRIGGER trg_catalog_products_updated_at BEFORE UPDATE ON catalog_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_catalog_variants_updated_at ON catalog_variants;
CREATE TRIGGER trg_catalog_variants_updated_at BEFORE UPDATE ON catalog_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
