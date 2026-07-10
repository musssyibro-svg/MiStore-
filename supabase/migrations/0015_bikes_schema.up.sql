-- 0015_bikes_schema.up.sql
-- Bikes did not exist as a database concept anywhere in this project. The 177-item
-- catalog in assets/bikes/data/products.json was the only source of truth, and
-- bikes.html read that static file directly. This migration gives bikes a real
-- home in the database so the admin can manage them (including images) without
-- ever touching a JSON file or HTML again.
--
-- Field set below mirrors every field actually present in assets/bikes/data/products.json
-- (supplier, model, motor, battery_type, voltage, top_speed, range, wheel_size, brake,
-- weight, max_load, cbm, fob pricing, qty per container, etc.) plus the admin-manageable
-- fields requested (name, description, stock, sku, warranty, shipping, colors, sizes,
-- featured, homepage, SEO, variants-as-jsonb).

-- ---------------------------------------------------------------------------
-- bike_categories: full CRUD categories/subcategories for bikes (separate from
-- the phone `categories` table, which is keyed to brand+condition and not a fit).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bike_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES bike_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  position integer DEFAULT 0,
  featured boolean DEFAULT false,
  hidden boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bike_categories_parent ON bike_categories(parent_id);

-- ---------------------------------------------------------------------------
-- bikes: the product record itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES bike_categories(id) ON DELETE SET NULL,

  -- identity
  name text NOT NULL,                 -- display name shown to customers
  slug text UNIQUE,
  model text,                         -- supplier's model code, e.g. "SL"
  supplier text,                      -- e.g. "KUAILUZX", "Leilin"
  sku text UNIQUE,
  brand text,
  description text,

  -- commercial
  fob_price numeric,
  fob_price_high numeric,
  fob_currency text DEFAULT 'USD',    -- USD or RMB depending on supplier
  cbm numeric,
  cbm_source text,
  customer_price_ngn numeric,         -- last computed price snapshot (see bike_config formula)
  price_breakdown jsonb DEFAULT '{}'::jsonb,
  stock integer DEFAULT 0,
  qty_20fcl integer,
  qty_40hq integer,
  availability text DEFAULT 'in_stock',
  warranty text,
  shipping_notes text,

  -- specs (kept as jsonb so new spec fields never require a migration)
  specs jsonb DEFAULT '{}'::jsonb,    -- motor, battery_type, voltage, top_speed, range,
                                       -- wheel_size, brake, weight, max_load, dimension,
                                       -- packing_size, frame, colors, sizes, battery
  features jsonb DEFAULT '[]'::jsonb,
  motor_upgrades jsonb DEFAULT '[]'::jsonb,
  battery_price_map jsonb DEFAULT '[]'::jsonb,
  accessory_options jsonb DEFAULT '[]'::jsonb,
  included_in_fob jsonb DEFAULT '[]'::jsonb,
  price_ladder jsonb DEFAULT '[]'::jsonb,
  variants jsonb DEFAULT '[]'::jsonb, -- e.g. battery/voltage variant combinations with price deltas

  -- media beyond photos
  video_url text,
  model_3d_url text,

  -- merchandising
  featured boolean DEFAULT false,
  show_on_homepage boolean DEFAULT false,
  status text DEFAULT 'draft',        -- draft | published | archived
  seo jsonb DEFAULT '{}'::jsonb,      -- {title, description, keywords}

  -- migration/provenance bookkeeping (safe to ignore once fully migrated off JSON)
  data_confidence text,
  duplicate_group text,
  is_primary boolean DEFAULT true,
  group_size integer DEFAULT 1,
  legacy_id text,                     -- original id from products.json, e.g. "KU-MOTO-001"
  metadata jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bikes_category ON bikes(category_id);
CREATE INDEX IF NOT EXISTS idx_bikes_supplier ON bikes(supplier);
CREATE INDEX IF NOT EXISTS idx_bikes_status ON bikes(status);
CREATE INDEX IF NOT EXISTS idx_bikes_featured ON bikes(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_bikes_legacy_id ON bikes(legacy_id);

-- ---------------------------------------------------------------------------
-- bike_images: dedicated media table for bikes (kept separate from the generic
-- `images` table on purpose -- bikes need cover/gallery semantics and reorder
-- that the generic table doesn't model, and this keeps the bike-images edge
-- function self-contained instead of sharing a table with phone images).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bike_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'bike-photos',
  storage_path text NOT NULL,         -- original, full-resolution file
  filename text,
  mime text,
  filesize integer,
  width integer,
  height integer,
  is_cover boolean DEFAULT false,
  position integer DEFAULT 0,
  alt_text text,
  metadata jsonb DEFAULT '{}'::jsonb, -- e.g. {source:'admin_upload'|'json_import', uploader}
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bike_images_bike ON bike_images(bike_id);
CREATE INDEX IF NOT EXISTS idx_bike_images_position ON bike_images(bike_id, position);
-- Only one cover image per bike.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bike_images_one_cover ON bike_images(bike_id) WHERE is_cover = true;

-- ---------------------------------------------------------------------------
-- bike_config: the pricing/FX config that admin.html's "Bike pricing" tab
-- already writes to (db.from('bike_config')...) but which no prior migration
-- ever created. Without this table that tab has been failing silently.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bike_config (
  id text PRIMARY KEY,
  shipping_per_cbm_ngn numeric NOT NULL DEFAULT 500000,
  logistics_service_ngn numeric NOT NULL DEFAULT 70000,
  rmb_to_ngn numeric NOT NULL DEFAULT 208,
  usd_to_rmb numeric NOT NULL DEFAULT 7.2,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO bike_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security -- follow the exact pattern already used by catalog_prices
-- elsewhere in this project (public read, authenticated-write).
-- ---------------------------------------------------------------------------
ALTER TABLE bike_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE bikes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bike_images       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bike_config        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bike_categories_public_read" ON bike_categories;
CREATE POLICY "bike_categories_public_read" ON bike_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "bike_categories_admin_write" ON bike_categories;
CREATE POLICY "bike_categories_admin_write" ON bike_categories FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "bikes_public_read" ON bikes;
CREATE POLICY "bikes_public_read" ON bikes FOR SELECT USING (true);
DROP POLICY IF EXISTS "bikes_admin_write" ON bikes;
CREATE POLICY "bikes_admin_write" ON bikes FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "bike_images_public_read" ON bike_images;
CREATE POLICY "bike_images_public_read" ON bike_images FOR SELECT USING (true);
DROP POLICY IF EXISTS "bike_images_admin_write" ON bike_images;
CREATE POLICY "bike_images_admin_write" ON bike_images FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "bike_config_public_read" ON bike_config;
CREATE POLICY "bike_config_public_read" ON bike_config FOR SELECT USING (true);
DROP POLICY IF EXISTS "bike_config_admin_write" ON bike_config;
CREATE POLICY "bike_config_admin_write" ON bike_config FOR ALL USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Storage bucket for bike photos. If your Supabase project restricts writes to
-- storage.buckets from SQL, create this bucket from Dashboard -> Storage instead
-- (name: bike-photos, public: true) -- this INSERT is a convenience, not a hard
-- requirement.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('bike-photos', 'bike-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "bike_photos_public_read" ON storage.objects;
CREATE POLICY "bike_photos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'bike-photos');

DROP POLICY IF EXISTS "bike_photos_admin_write" ON storage.objects;
CREATE POLICY "bike_photos_admin_write" ON storage.objects
  FOR ALL USING (bucket_id = 'bike-photos' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'bike-photos' AND auth.uid() IS NOT NULL);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bikes_updated_at ON bikes;
CREATE TRIGGER trg_bikes_updated_at BEFORE UPDATE ON bikes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_bike_images_updated_at ON bike_images;
CREATE TRIGGER trg_bike_images_updated_at BEFORE UPDATE ON bike_images
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
