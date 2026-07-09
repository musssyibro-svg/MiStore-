# ADMIN_FEATURES.md

This document outlines the admin features implemented in the repo and how to deploy them.

Overview
- Mobile-first admin app: admin_mobile/ (new SPA) — login, product CRUD, homepage blocks, image manager UI hooks.
- Supabase Edge Functions: supabase/functions/src/functions/* — auth, products, homepage, images.
- Database migrations: supabase/migrations/0004_admin_images.up.sql, 0005_admin_activity.up.sql and corresponding down scripts.

Developer checklist to deploy
1. Apply DB migrations (0004, 0005) using your normal migration process or psql.
2. Deploy Supabase Edge Functions (build and publish). Ensure environment variables are set:
   - SUPABASE_URL, SUPABASE_SERVICE_KEY (or SERVICE_ROLE key), JWT_SECRET, CATALOG_PHOTO_BUCKET
3. Configure storage bucket `catalog-photos` in Supabase Storage (public or private as desired). Update CORS.
4. Deploy admin_mobile files to a static host (or server) and configure API_BASE to point to your functions gateway (for example Netlify or Supabase Functions URL).

Security notes
- Use SERVICE_ROLE key only in server-side functions (never in client JS). Functions use service key to modify DB and storage.
- Admin UI authenticates using admin-login which returns a JWT signed with JWT_SECRET — functions must verify JWT where required.

Image processing
- The example image handler uses sharp to create thumbnails/webp derivatives. In production, prefer asynchronous jobs (queue) and store derivative paths in images.variants.

Do not modify storefront or existing admin.html until you explicitly approve integration of the new admin UI.
