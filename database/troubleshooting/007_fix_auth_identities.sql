-- ============================================================
-- POTENTIAL FIX: Check auth.identities table structure
-- ============================================================
-- The error suggests Supabase Auth can't query auth.identities
-- This might be a schema or permission issue
-- ============================================================

-- Check if auth.identities has proper indexes on email
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'auth'
AND tablename = 'identities'
AND indexdef LIKE '%email%';

-- If no index on email, this might be the issue
-- But DON'T create indexes manually - Supabase manages the auth schema

-- ============================================================
-- RECOMMENDATION:
-- This is likely a Supabase platform issue, not your code.
-- 
-- Try these:
-- 1. Check Supabase Dashboard → Settings → General → Project status
-- 2. Try restarting your Supabase project (if possible)
-- 3. Contact Supabase support if the issue persists
-- 
-- Workaround: Use admin client with email_confirm: true
-- This should bypass some checks
-- ============================================================

