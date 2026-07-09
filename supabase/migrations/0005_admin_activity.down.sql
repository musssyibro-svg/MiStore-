-- 0005_admin_activity.down.sql
DROP INDEX IF EXISTS idx_admin_activity_admin;
DROP TABLE IF EXISTS admin_activity_logs;
