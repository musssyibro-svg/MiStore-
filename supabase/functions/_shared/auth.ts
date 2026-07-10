// supabase/functions/_shared/auth.ts
//
// admin.html already authenticates real people via Supabase Auth
// (db.auth.signInWithPassword) and every existing RLS policy in this project
// gates writes on `auth.uid() is not null`. This helper verifies the same
// session server-side, so the bikes/bike-images functions require exactly the
// same login the rest of the admin already uses -- no separate password
// system, no custom JWT secret to manage.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client: bypasses RLS. Only ever used after verifyAdmin() passes,
// or for public GET reads where RLS already allows anonymous select.
export const adminClient: SupabaseClient = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

export class UnauthorizedError extends Error {
  constructor(msg = "unauthorized") {
    super(msg);
    this.name = "UnauthorizedError";
  }
}

// Verifies the Authorization: Bearer <access_token> header against Supabase Auth.
// Throws UnauthorizedError if missing/invalid. Returns the authenticated user.
export async function verifyAdmin(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new UnauthorizedError("missing bearer token");

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) throw new UnauthorizedError("invalid session");
  return data.user;
}
