-- ============================================================
-- SIMPLE CLEANUP: Remove Triggers & Functions
-- ============================================================
-- Step 1: Remove ALL triggers and functions that interfere
-- ============================================================

-- Remove triggers
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Remove functions
DROP FUNCTION IF EXISTS public.handle_email_confirmation() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_confirmed() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Now Supabase Auth works natively without interference
-- Profile creation is handled in application code (RegisterUser.ts)
-- ============================================================

