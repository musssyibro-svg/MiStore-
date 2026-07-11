# MiStore — Project Status

_Last updated: 2026-07-11_

MiStore is a phone-managed, Apple-style marketplace. The owner controls every
product, price, and photo from a single admin dashboard (`admin.html`) — no code
or JSON editing required to run the store. This document is the source of truth
for how the project is built and how to extend it.

---

## 1. Current architecture

**Front end:** Static HTML/CSS/vanilla-JS. No build step, no framework. Served by
GitHub Pages directly from `main` (`.nojekyll` disables Jekyll so files are
served as-is).

**Back end:** Supabase (Postgres + Row Level Security + Storage). The admin talks
to Supabase **directly** via the JS client (`db.from(...)`, `db.storage`) using
the signed-in admin session. **No Edge Functions are required** for any admin
operation — everything works from a phone browser.

**Pages**

| File | Role |
|------|------|
| `index.html` | Customer storefront (phones + sections) |
| `bikes.html` | Electric Mobility storefront (bikes) |
| `admin.html` | Owner control panel (all management) |
| `track.html` | Customer order tracking |

**Admin subsystems** (tabs in `admin.html`)

| Tab | Data source | Notes |
|-----|-------------|-------|
| On the way / History | `orders` tables | Order tracker (original module) |
| 🏍 Bikes | `bikes*` tables (direct Supabase) | Full CRUD + images |
| 🎧 Accessories | `catalog_*` tables (direct Supabase) | **Reusable catalog engine** — see §7 |
| 📱 Phone prices | `ADMIN_CATALOG` in code (+ optional `catalog_prices` fallback) | Condition × storage price matrix |
| 🖼 Phone photos | Storage bucket `catalog-photos` | Per model/condition photo slots |
| ⭐ Customer stories | showcase tables | Reviews / stock showcase |
| 💰 Bike pricing | `bike_config` | FX + shipping rates for bike price formula |
| ⚙️ Store settings | `store_settings` | ¥→₦ rate + sea/air shipping rates |

**Three independent engines** exist by design:
1. **Catalog engine** (Accessories/Kitchen/Electronics/Laptops/…) — one reusable
   implementation, category-driven. This is the target architecture for all new
   product types.
2. **Bikes engine** — dedicated (specialized fields: CBM, FOB, motor specs).
   Direct Supabase, live and verified.
3. **Phones engine** — dedicated (condition × storage price matrix).

Bikes and Phones are intentionally separate from the catalog engine because they
are live and verified; they can be migrated onto the catalog engine later (§6).

---

## 2. Database schema

Two one-paste SQL files set everything up (Supabase → SQL Editor → Run):
`supabase/BIKES_SETUP.sql` and `supabase/CATALOG_SETUP.sql`. RLS on every table:
**public read, authenticated (admin) write** (except `catalog_products` /
`catalog_variants`, which are admin-only so supplier ¥ pricing is never exposed —
see §8).

**Bikes**
- `bike_categories(id, parent_id, name, slug, position, featured, hidden, metadata, …)`
- `bikes(id, category_id, name, slug, model, supplier, sku, brand, description, fob_price, fob_currency, cbm, customer_price_ngn, stock, availability, warranty, specs jsonb, variants jsonb, featured, show_on_homepage, status, seo jsonb, legacy_id, metadata jsonb, …)`
- `bike_images(id, bike_id, storage_bucket, storage_path, is_cover, position, …)`
- `bike_config(id, shipping_per_cbm_ngn, logistics_service_ngn, rmb_to_ngn, usd_to_rmb, …)`

**Catalog (reusable engine)**
- `store_settings(id, exchange_rate, sea_rate_per_cbm, air_rate_per_kg, default_profit_pct, …)`
- `catalog_categories(id, parent_id, name, slug, position, featured, hidden, icon, metadata jsonb, …)` — `metadata.fields` holds each category's custom spec schema.
- `catalog_products(id, category_id, supplier_id, name, slug, brand, supplier, description, moq, qty_per_carton, sold_by_carton, weight_kg, cbm, stock, featured, show_on_homepage, status, seo jsonb, metadata jsonb, …)` — `metadata.attributes` holds per-product custom field values; `metadata.legacy_image` points at the imported supplier photo until one is uploaded.
- `catalog_variants(id, product_id, spec1, spec2, variant_label, sku, rmb_price, profit_ngn, moq, qty_per_carton, weight_kg, cbm, stock, position, is_default, …)`
- `catalog_images(id, product_id, variant_id, storage_bucket, storage_path, is_cover, position, …)`

**Storage buckets:** `bike-photos`, `catalog-photos` (both public-read).

**Pricing formula (catalog):** `total = (rmb_price × exchange_rate) + shipping
(sea = cbm × sea_rate_per_cbm, or air = weight_kg × air_rate_per_kg, or none) +
profit`. When a variant has an explicit `profit_ngn` it is used; **when profit is
blank, the temporary default margin applies**: `total = (cost + shipping) × (1 +
default_profit_pct/100)` (default **15%**, editable in Store settings — e.g. a
₦10,000 cost+shipping → ₦11,500). An explicit ₦0 profit is honoured (no margin).
Computed live from `store_settings` — changing one rate updates every product.
Customers never see `rmb_price`.

---

## 3. Folder structure

```
index.html, bikes.html, admin.html, track.html   # the 4 pages
.nojekyll                                         # disables Jekyll on GitHub Pages
PROJECT_STATUS.md                                 # this file
SUPABASE_SETUP.md                                 # setup notes

supabase/
  BIKES_SETUP.sql        # one-paste bikes schema (phone deploy)
  CATALOG_SETUP.sql      # one-paste catalog schema (phone deploy)
  migrations/            # full migration history (0014–0016)
  functions/             # LEGACY edge functions — NOT used by admin anymore (see §5)

assets/
  bikes/                 # bike storefront data + curated images
  phones/, models/, slides/, cutouts/, lineups/, vendor/
  icons.js, manifest.json

catalog-import/
  data/*_products.json   # parsed supplier catalogs (earphone, powerbank, smartwatch, speaker)
  images/<category>/*    # 434 supplier images

scripts/                 # import-bikes.mjs, import-catalog.mjs (dev/computer only)
test/                    # bike-admin mock harness
images/                  # phone product photos
```

---

## 4. Features completed

**Catalog engine (reusable, all categories):**
- Product CRUD (create / edit / delete) — one implementation for every category.
- Variants with live per-variant price preview (no-shipping / sea / air totals).
- Image manager: multi-upload (client-side compression to ≤1600px JPEG), set
  cover, drag-reorder, delete — direct to Supabase Storage.
- Search (name / supplier id / brand) + category filter + **status filter chips**
  (All / Published / Draft / Trash).
- Publish / draft / archive lifecycle.
- **Import** parsed supplier catalog → drafts.
- **Export** full catalog to JSON (admin backup).
- **Category Manager**: add / rename / reorder / hide / delete any store section
  from the UI — no SQL, no code.
- **Per-category custom fields**: define a category's spec inputs (e.g. Laptops →
  CPU, RAM); the product form renders them generically.

**Bikes engine:** full CRUD, images, categories, soft-delete/trash/restore,
duplicate, preview, duplicate-detection, availability, import-from-JSON, price
config. Direct Supabase, phone-native.

**Phones engine:** condition × storage price matrix editing, per-model photos.

**Platform:** dark mode, mobile bottom nav, instant search, wishlist, 3D iPhone
hero, GitHub Pages deploy from `main` with `.nojekyll`.

---

## 5. Remaining work

- **Customer storefront sections** for catalog products (Accessories/Kitchen/…):
  the admin manages them, but `index.html` does not yet render them to customers.
  Requires a public read path (see §8). **Deliberately deferred** until the admin
  is verified, per the "don't cut over until verified" plan.
- **Kitchen bulk data**: categories are seeded, but the Kitchen PDFs are not yet
  parsed into `catalog-import/data/`. Kitchen products can be added manually now.
- **Migrate Phones and Bikes onto the catalog engine** (optional; they work today).
- **Customer-stories (showcase) product editing** — requested; not yet wired to
  the reusable engine.
- **Delete the legacy `supabase/functions/` edge functions** once confirmed
  unused by any remaining tab (Phone prices' optional fallback still references a
  price table, not an edge function).

---

## 6. Known limitations

- **Naming overlap:** the Phones price system also uses the word "catalog"
  (`ADMIN_CATALOG`, `loadCatalogPrices`, `renderCatalogPhotos`, `CATALOG_MODELS`)
  while the reusable engine uses `catalog_*` tables and `ctlg*`/`renderCatalogTab`.
  They do **not** share variables (verified — the engine's bucket const is
  `CATALOG_PHOTO_BUCKET2`), but the naming is confusing. Renaming the phone system
  is deferred to avoid destabilizing a live subsystem.
- **Import source list is fixed** (`earphone, powerbank, smartwatch, speaker`) —
  these are the parsed data-file names, not engine categories. New bulk imports
  need their JSON added to `catalog-import/data/` (or products added by hand).
- **Client-side filtering/search** loads up to 500 catalog rows then filters in
  the browser — fine for thousands of products; revisit if the catalog grows past
  that.
- **Storefront is still JSON-powered** for bikes/phones (intentional fallback).
- Supabase publishable (anon) key is embedded in `admin.html` — expected for a
  Supabase client; security rests on RLS, not key secrecy.

---

## 7. Migration guide — adding a new store category (no code)

1. Open `admin.html` → **🎧 Accessories** tab → **⚙ Categories**.
2. Type the name (e.g. `Laptops`) and an emoji, tap **+ Add**. The section now
   exists and runs on the same engine as every other category.
3. (Optional) Tap **Fields** on the category and enter comma-separated spec labels
   (e.g. `CPU, RAM, Screen, Storage`). Those inputs now appear on every product in
   that category; values save to `catalog_products.metadata.attributes`.
4. Add products with **+ New product**, pick the category, fill variants/pricing,
   upload photos, set status to **Published**.

No JavaScript, SQL, or deploy is needed. To add a category via SQL instead, insert
a row into `catalog_categories` (`name`, `slug`, `position`, optional `icon`,
optional `metadata.fields`).

---

## 8. A note on the customer storefront + supplier pricing

`catalog_products` / `catalog_variants` are **admin-read-only** by RLS, so the
supplier ¥ price (`rmb_price`) can never be read by an anonymous storefront
visitor. When the customer storefront is built, expose products through **one of**:
- a computed `customer_price_ngn` column written at save time (like bikes), read
  via a public policy that excludes `rmb_price`; or
- a read-only view / materialized projection that omits supplier pricing.

Do **not** simply add a blanket public-read policy to `catalog_variants` — that
would expose `rmb_price`.

---

## 9. Deployment instructions (phone-only)

**One-time database setup (per Supabase project):**
1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste all of `supabase/BIKES_SETUP.sql` → **Run**.
3. New query → paste all of `supabase/CATALOG_SETUP.sql` → **Run**.

**GitHub Pages:**
- Repo **Settings → Pages → Build and deployment → Source = Deploy from a branch,
  Branch = `main`, folder = `/ (root)`**. (Serving the wrong branch is what
  previously froze the site.)
- `.nojekyll` is committed, so Pages serves files as-is.

**Shipping a change:**
1. Commit to the working branch, open a PR into `main`, merge (squash).
2. GitHub Pages auto-builds from `main` (watch **Actions → "pages build and
   deployment"** — it must show the run on **branch `main`** and conclusion
   **success**).
3. Load `admin.html?v=N` (bump `N`) to bypass Safari's cache.

**Data:** in the admin, use **Import** (bikes: "Import my existing bikes";
catalog: "Import accessories catalog") to load starting data.

---

## 10. Rollback instructions

**Revert a bad deploy (code):**
```
git revert <merge_commit_sha>      # creates an inverse commit
git push origin main               # Pages redeploys the previous state
```
Or reset `main` to a known-good commit and force-push (only if you own the branch
policy):
```
git checkout main
git reset --hard <good_sha>
git push --force-with-lease origin main
```
GitHub Pages redeploys automatically on push to `main`.

**Emergency serve-last-good:** GitHub Pages keeps serving the last successful
build until a new one succeeds, so a broken commit that fails to build will not
take the live site down — fix forward and push again.

**Database:** schema SQL is idempotent (safe to re-run). Data changes are not
auto-versioned; use the catalog **Export JSON** button before bulk edits/imports
so you have a restore point. Soft-deleted records (status `archived`) are
recoverable from the **Trash** filter; only "Delete permanently" is irreversible.

**Storefront fallback:** the customer storefront is still JSON-powered, so an
admin/Supabase issue does not affect what customers see.
