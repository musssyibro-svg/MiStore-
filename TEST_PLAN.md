# MiStore — Acceptance Test Plan (QA)

Run this end-to-end on your **real deployment against the live Supabase database**,
on **both** an iPhone (Safari) and a desktop (Chrome). Static analysis and
deployment are already verified in code; this plan covers the runtime CRUD that
can only be confirmed against a real database and browser.

**Before you start:**
- Both SQL files have been run once in Supabase → SQL Editor: `BIKES_SETUP.sql`
  and `CATALOG_SETUP.sql` (re-running is safe).
- Open the admin at `admin.html?v=NN` (bump `NN` to bypass Safari cache).
- Open the browser console (desktop: DevTools → Console) to watch for red errors.
  Every step lists the console errors that would indicate failure.

Mark each row ✅ pass / ❌ fail. A ❌ on any **Blocker** row means do not go to
production.

---

## 1. Login / Auth  — *Blocker*
- **Expected:** Entering the admin shows the dashboard, not a login wall; refresh keeps you logged in.
- **Steps:** Load `admin.html` → if prompted, sign in with your Supabase email/password → reload the page.
- **DB tables:** `auth.users` (Supabase Auth).
- **Failure symptoms:** Stuck on login after correct password; logged out on every refresh; every tab shows "Failed to load".
- **Console errors:** `Invalid login credentials`; `JWT expired`; `401`.

## 2. Phones — prices  — *Blocker*
- **Expected:** Phone prices tab lists iPhone models by condition (Clean / Battery / Screen / Double) with editable prices; edits persist after reload.
- **Steps:** 📱 Phone prices → change one price → save → reload → confirm it stuck.
- **DB tables:** `catalog_prices` (falls back to bundled `ADMIN_CATALOG` if the table is absent).
- **Failure symptoms:** Prices revert after reload; a condition/model is missing.
- **Console errors:** `relation "catalog_prices" does not exist` (only a problem if you rely on DB-stored phone prices).

## 3. Phones — photos
- **Expected:** Each model/condition has a photo slot; uploading replaces the image and it persists.
- **Steps:** 🖼 Phone photos → tap a slot → choose an image → confirm it shows after reload.
- **DB tables:** Storage bucket `catalog-photos`.
- **Failure symptoms:** Upload spins forever; image 404s after reload.
- **Console errors:** `403`/`row-level security` on `storage.objects`; `Bucket not found`.

## 4. Bikes — list + CRUD  — *Blocker*
- **Expected:** 🏍 Bikes lists bikes (after Import); opening one shows its form; edits save and persist.
- **Steps:** Bikes → ⬇ Import my existing bikes (first time) → open a bike → change the name → Save changes → back → reload → confirm.
- **DB tables:** `bikes`, `bike_categories`, `bike_images`.
- **Failure symptoms:** Stuck on "Loading…"; "Failed to load bikes"; save toast shows an error.
- **Console errors:** `relation "bikes" does not exist` (run `BIKES_SETUP.sql`); `PGRST200` embedding error on `bike_images`.

## 5. Bikes — images (upload / cover / reorder / delete)
- **Expected:** Same behaviour as catalog images (§12–14) but on the bikes table.
- **Steps:** Open a bike → upload 2 photos → set the 2nd as cover → drag to reorder → delete one → reload.
- **DB tables:** `bike_images`, Storage `bike-photos`.
- **Failure symptoms:** Upload fails; cover doesn't move; order/deletion doesn't persist.
- **Console errors:** `403` on `storage.objects`; unique-violation on cover index.

## 6. Bike pricing config
- **Expected:** 💰 Bike pricing edits (CBM shipping, logistics, ¥/$ rates) save and change bike prices.
- **Steps:** Change ¥→₦ rate → Save → confirm a bike's "From" price changes on the bikes page.
- **DB tables:** `bike_config`.
- **Failure symptoms:** Save errors; prices don't change.
- **Console errors:** `relation "bike_config" does not exist`.

## 7. Catalog — load + list  — *Blocker*
- **Expected:** 🎧 Accessories lists catalog products (after Import); counts in the status chips are correct.
- **Steps:** Accessories tab → wait for list.
- **DB tables:** `catalog_products` (+ embedded `catalog_categories`, `catalog_variants`, `catalog_images`).
- **Failure symptoms:** Stuck "Loading…"; "Failed to load catalog".
- **Console errors:** `relation "catalog_products" does not exist` (run `CATALOG_SETUP.sql`); `PGRST200` relationship error.

## 8. Catalog — Import  — *Blocker*
- **Expected:** ⬇ Import accessories catalog inserts earbuds/power banks/speakers/smart watches as **drafts**; re-running does not duplicate them.
- **Steps:** With an empty list, tap Import → wait for "✓ Imported N products" → tap Import again → confirm no duplicates.
- **DB tables:** `catalog_products`, `catalog_variants`, `catalog_categories`.
- **Failure symptoms:** 0 imported; duplicates on second run; missing variants.
- **Console errors:** unique-violation on `uq_catalog_products_supplier_cat`; `404` fetching `catalog-import/data/*.json`.

## 9. Catalog — create / edit product  — *Blocker*
- **Expected:** + New product → fill fields → Create; edits save and persist after reload.
- **Steps:** + New product → name "QA Test" → pick a category → add a variant with ¥ price → Create product → reload → open it → confirm data.
- **DB tables:** `catalog_products`, `catalog_variants`.
- **Failure symptoms:** Save errors; data lost after reload; variant not saved.
- **Console errors:** `null value in column "name"`; `403 row-level security` (not logged in).

## 10. Catalog — variants + live price preview
- **Expected:** Adding/removing variants works; the preview shows no-shipping/sea/air totals; leaving ₦ profit blank applies the **default margin** (Store settings), and typing a ₦ profit overrides it.
- **Steps:** In a product, add a variant with ¥ price 50, blank profit → preview should be ≈ ¥50×rate×1.15 → type a profit → preview changes → remove the variant.
- **DB tables:** `catalog_variants`, `store_settings` (reads `default_profit_pct`).
- **Failure symptoms:** Preview is `NaN` or 0; margin not applied when profit blank; removed variant reappears.
- **Console errors:** none expected (pure computation).

## 11. Catalog — custom fields (per category)
- **Expected:** A category's custom fields (e.g. Laptops → CPU/RAM) appear on its products and save.
- **Steps:** ⚙ Categories → Fields on "Laptops" → enter `CPU, RAM` → back → open/create a Laptops product → fill CPU/RAM → Save → reload → confirm values.
- **DB tables:** `catalog_categories.metadata.fields`, `catalog_products.metadata.attributes`.
- **Failure symptoms:** Fields don't appear after choosing the category; values not saved.
- **Console errors:** none expected.

## 12. Catalog — image upload
- **Expected:** Uploading photos compresses and stores them; first upload becomes the cover.
- **Steps:** Open a saved product → drop/select 2 images → wait for "✓ Uploaded".
- **DB tables:** `catalog_images`, Storage `catalog-photos`.
- **Failure symptoms:** Spinner never resolves; images 404.
- **Console errors:** `403`/`row-level security` on `storage.objects`; `Bucket not found`.

## 13. Catalog — set cover image
- **Expected:** Tapping "Cover" on a non-cover image makes it the cover; only one cover at a time.
- **Steps:** With ≥2 images, tap Cover on the second → confirm the badge moves.
- **DB tables:** `catalog_images` (unique cover index).
- **Failure symptoms:** Two covers; cover doesn't change.
- **Console errors:** unique-violation on `uq_catalog_images_one_cover`.

## 14. Catalog — reorder + delete images
- **Expected:** Drag reorders and persists; Delete removes the image and its storage file.
- **Steps:** Drag an image to a new position → reload → confirm order kept → delete one → reload → confirm gone.
- **DB tables:** `catalog_images`, Storage `catalog-photos`.
- **Failure symptoms:** Order resets on reload; deleted image reappears.
- **Console errors:** `403` on update/delete.

## 15. Catalog — search
- **Expected:** Typing filters the list by name / supplier id / brand.
- **Steps:** Type part of a product name → list narrows → clear → list restores.
- **DB tables:** `catalog_products` (client-side filter).
- **Failure symptoms:** No filtering; list empties incorrectly.

## 16. Catalog — filters (category + status)  — *Blocker*
- **Expected:** Category dropdown filters by section; status chips (All / Published / Draft / Trash) filter by status with correct counts.
- **Steps:** Pick a category → list narrows → tap Draft chip → only drafts show → tap Trash → only archived show.
- **DB tables:** `catalog_products` (client-side).
- **Failure symptoms:** Chips don't filter; counts wrong.

## 17. Catalog — publish / draft / archive  — *Blocker*
- **Expected:** Changing a product's status persists and moves it between chips.
- **Steps:** Open a draft → set status Published → Save → it moves to Published chip → set Archived → appears under Trash.
- **DB tables:** `catalog_products.status`.
- **Failure symptoms:** Status reverts; product doesn't move between chips.

## 18. Catalog — delete product
- **Expected:** Delete removes the product and its variants/images (cascade).
- **Steps:** Open a QA product → Delete product → confirm → it's gone after reload; its images removed from storage.
- **DB tables:** `catalog_products` (cascades to `catalog_variants`, `catalog_images`).
- **Failure symptoms:** Product remains; orphaned variants/images.
- **Console errors:** `403` on delete (not logged in).

## 19. Category Manager  — *Blocker*
- **Expected:** Add / rename / reorder / hide / delete categories from the UI; changes persist.
- **Steps:** ⚙ Categories → + Add "QA Cat" with an emoji → rename it → move it up/down → Hide then Show → delete it → reload and confirm each.
- **DB tables:** `catalog_categories`.
- **Failure symptoms:** Add/rename/reorder doesn't persist; deleting a category errors.
- **Console errors:** unique-violation on `slug`; `403`.

## 20. Export
- **Expected:** ⬆ Export JSON downloads a `.json` file of all products + variants.
- **Steps:** Tap Export JSON → a file downloads → open it → confirm products/variants present.
- **DB tables:** `catalog_products`, `catalog_variants` (read).
- **Failure symptoms:** No download; empty file; error toast.
- **Console errors:** `403` on select.

## 21. Store settings (incl. default margin)  — *Blocker*
- **Expected:** Editing exchange rate / shipping / **default profit %** saves and changes every catalog total live.
- **Steps:** ⚙️ Store settings → set Default profit margin to 15 → Save → open a product with blank-profit variants → preview totals reflect ×1.15.
- **DB tables:** `store_settings`.
- **Failure symptoms:** Save errors; totals don't change.
- **Console errors:** `relation "store_settings" does not exist`; `column "default_profit_pct" does not exist` (re-run `CATALOG_SETUP.sql`).

## 22. Storefront visibility (customer view)
- **Expected:** Customer storefront (`index.html`, `bikes.html`) still loads and shows phones/bikes. (Catalog/Accessories customer sections are **not built yet** — a known, intentional gap.)
- **Steps:** Open `index.html` and `bikes.html` as a normal visitor (logged out) → confirm they load and prices show.
- **DB tables:** none (JSON-powered fallback).
- **Failure symptoms:** Storefront blank or broken.
- **Note:** Accessories/Kitchen will not appear to customers until the storefront sections are built — expected for now.

## 23. Mobile Safari (iPhone)  — *Blocker*
- **Expected:** Every ✅ above also passes on iPhone Safari; tabs wrap and are reachable; image picker opens the camera roll.
- **Steps:** Repeat §7–§21 on the phone.
- **Failure symptoms:** Tabs cut off; buttons unresponsive; image picker won't open.

## 24. Desktop Chrome
- **Expected:** Same behaviour; console shows no red errors during a full pass.
- **Steps:** Repeat §7–§21 with DevTools → Console open.
- **Failure symptoms:** Any uncaught exception in the console during normal use.

---

## Release checklist (must be 100% before production)

**Blockers (all must pass):**
- [ ] 1 Login / session persistence
- [ ] 2 Phone prices persist
- [ ] 4 Bikes load + edit persist
- [ ] 7 Catalog loads
- [ ] 8 Import (no duplicates on re-run)
- [ ] 9 Create/edit product persists
- [ ] 16 Category + status filters work
- [ ] 17 Publish/draft/archive persists
- [ ] 19 Category Manager add/rename/reorder/hide/delete
- [ ] 21 Store settings incl. default margin recalculates totals
- [ ] 23 Full pass on iPhone Safari

**Non-blockers (should pass):**
- [ ] 3 Phone photos  · [ ] 5 Bike images  · [ ] 6 Bike pricing config
- [ ] 10 Variants + margin preview  · [ ] 11 Custom fields
- [ ] 12 Image upload  · [ ] 13 Cover  · [ ] 14 Reorder/delete
- [ ] 15 Search  · [ ] 18 Delete product  · [ ] 20 Export
- [ ] 22 Storefront still loads  · [ ] 24 Clean console on desktop

**Sign-off:** _Tester ________  Date ________  Result: PASS / FAIL_

When every Blocker is ✅, the admin is production-ready. Only then start building the
customer-facing catalog storefront sections (see PROJECT_STATUS.md §5, §8).
