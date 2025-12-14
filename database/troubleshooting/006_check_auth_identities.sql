-- ============================================================
-- CHECK auth.identities TABLE
-- ============================================================
-- This error suggests Supabase Auth can't query auth.identities
-- Let's check if the table exists and is accessible
-- ============================================================

-- 1. Check if auth.identities table exists
SELECT 
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_schema = 'auth'
AND table_name = 'identities';

-- 2. Check structure of auth.identities
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth'
AND table_name = 'identities'
ORDER BY ordinal_position;

-- 3. Check if we can query it (should work with service role)
SELECT COUNT(*) as identity_count FROM auth.identities;

-- 4. Check for indexes on email field
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'auth'
AND tablename = 'identities';

-- ============================================================
-- If any of these queries fail, there's a schema/permission issue
-- ============================================================

