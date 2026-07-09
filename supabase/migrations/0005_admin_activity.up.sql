-- 0005_admin_activity.up.sql
-- Simple activity log for admin actions (audit trail)
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id bigserial PRIMARY KEY,
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_admin ON admin_activity_logs(admin_user_id);
