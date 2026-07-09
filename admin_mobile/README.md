# Admin Mobile App (Mobile-first)

This is a new mobile-first Admin application that runs separately from the existing admin.html (which is unchanged). It's a single-page app that communicates with the Supabase Edge Functions created under supabase/functions/ and directly with Supabase for storage.

Files:
- admin_mobile/index.html
- admin_mobile/styles.css
- admin_mobile/app.js

Important: Replace SUPABASE_URL and SUPABASE_ANON_KEY placeholders with your project's values when deploying. The admin app expects an admin login token (JWT) issued by the admin-login function; store the token in localStorage and include it in Authorization headers for function calls.
