-- ============================================================
-- CHECK ALL TRIGGERS ON auth.users
-- ============================================================
-- Run this to see what triggers are currently active
-- ============================================================

SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'users'
AND event_object_schema = 'auth';

-- Check for any functions that might be interfering
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%user%' OR routine_name LIKE '%email%' OR routine_name LIKE '%profile%';

-- ============================================================
-- If you see triggers, remove them with:
-- database/schema/002_remove_email_trigger.sql
-- ============================================================

