-- ============================================================
-- REMOVE EMAIL CONFIRMATION TRIGGER
-- ============================================================
-- We're handling profile creation in application code instead
-- This is simpler and more reliable than database triggers
-- ============================================================

-- Remove the trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Remove the functions (optional, but good cleanup)
DROP FUNCTION IF EXISTS public.handle_email_confirmation();
DROP FUNCTION IF EXISTS public.handle_new_user_confirmed();
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Profile creation is now handled entirely in application code:
-- - See: src/application/usecases/RegisterUser.ts
-- - Profile is created immediately after user signup
-- - Works for both dev and production
-- ============================================================

