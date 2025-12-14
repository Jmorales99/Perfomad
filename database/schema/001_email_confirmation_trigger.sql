-- ============================================================
-- EMAIL CONFIRMATION TRIGGER
-- ============================================================
-- Creates profile automatically when user confirms email
-- This ensures email confirmation is required before profile creation
-- ============================================================
-- NOTE: We use DEFERRED triggers to avoid interfering with 
-- Supabase Auth's email checking during user creation
-- ============================================================

-- Function to handle email confirmation
CREATE OR REPLACE FUNCTION public.handle_email_confirmation()
RETURNS TRIGGER AS $$
BEGIN
  -- When email is confirmed (transition from NULL to NOT NULL), create profile
  IF NEW.email_confirmed_at IS NOT NULL AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at) THEN
    BEGIN
      INSERT INTO public.profiles (id, email, name, created_at, updated_at)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', 'User'),
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET 
        email = EXCLUDED.email,
        name = COALESCE(EXCLUDED.name, profiles.name),
        updated_at = NOW();
    EXCEPTION
      WHEN OTHERS THEN
        -- Log error but don't fail the email confirmation
        RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on email confirmation (runs on UPDATE only)
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_email_confirmation();

-- Comments
COMMENT ON FUNCTION public.handle_email_confirmation() IS 'Creates profile when email is confirmed. Only runs on UPDATE to avoid interfering with Auth email checks.';

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Profiles will be created automatically when:
-- - User confirms their email (UPDATE trigger only)
-- 
-- NOTE: We ONLY use UPDATE trigger (no INSERT trigger) to avoid
-- interfering with Supabase Auth's email checking during user creation.
-- 
-- For dev mode where email is confirmed immediately:
-- - The code manually creates the profile (see RegisterUser usecase)
-- - OR the email confirmation UPDATE will fire immediately after INSERT
-- 
-- Email confirmation is REQUIRED before profile creation
-- ============================================================

