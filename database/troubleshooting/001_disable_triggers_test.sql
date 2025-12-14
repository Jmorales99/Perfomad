-- ============================================================
-- TROUBLESHOOTING: Temporarily disable triggers to test
-- ============================================================
-- Run this to disable triggers and test if they're causing the issue
-- ============================================================

-- Disable the email confirmation trigger
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;

-- Verify triggers are disabled
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'users'
AND event_object_schema = 'auth';

-- ============================================================
-- Test: Try creating a user now
-- If it works, the trigger was the issue
-- If it still fails, the issue is elsewhere
-- ============================================================

