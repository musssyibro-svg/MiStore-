# Functions README

This folder contains example Supabase Edge Functions (TypeScript) to power the Admin API:
- auth/admin-login: authenticate admin users (email/password) and issue JWT
- products: product CRUD (list, get, create, update, delete)
- homepage: homepage_blocks CRUD
- images: image manager helpers (presign upload, register asset, reorder, delete)

These functions are examples and must be deployed to your Supabase Edge Functions environment (or another server) and wired to your admin UI.

Notes:
- The example functions use environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY (or DB connection), JWT_SECRET.
- For image processing (crop, WebP, thumbnails) the functions use sharp; ensure the runtime supports native modules or build using appropriate toolchain.
