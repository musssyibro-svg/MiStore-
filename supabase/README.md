# Supabase project layout (minimal)

This directory contains the migration files and seed data for the Supabase migration
performed in the feature/supabase-migrations branch.

Structure:
- migrations/: reversible SQL migration files (.up.sql and .down.sql)
- seed/: raw_catalog.json is the exact baked RAW_CATALOG copied from the storefront
- functions/: placeholder for server-side functions
- policies/: placeholder for future RLS policies

Do NOT modify index.html as part of this change. Frontend integration of the
feature flag and loading from Supabase will be a follow-up after verification.
