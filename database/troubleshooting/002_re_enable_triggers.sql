-- ============================================================
-- Re-enable email confirmation trigger
-- ============================================================
-- Run this after testing to restore the trigger
-- ============================================================

-- Re-create the email confirmation trigger
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_email_confirmation();

-- Verify trigger is restored
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'users'
AND event_object_schema = 'auth';

