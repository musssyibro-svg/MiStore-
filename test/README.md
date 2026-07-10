# Admin tests

`bike-admin.mock.mjs` runs the real `admin.html` Bikes tab against an
in-memory mock of the Supabase REST/Edge API (no real Supabase needed),
and drives every management feature end-to-end with Playwright:

- list + status filters (All / Published / Draft / Trash) with counts
- soft delete (Move to trash) → Restore → permanent delete
- create / edit / duplicate a bike
- Sold-out availability + storefront-style badge
- live duplicate detection
- customer preview modal

Run: `CHROMIUM_PATH=/path/to/chromium node test/bike-admin.mock.cjs`
(omit CHROMIUM_PATH to use Playwright's bundled browser). All checks
should return truthy and `errs` should be empty.
