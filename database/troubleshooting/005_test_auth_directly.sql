-- ============================================================
-- TEST: Can we query auth.users directly?
-- ============================================================
-- This tests if there's a permission issue preventing Auth from working
-- ============================================================

-- Test 1: Can we read from auth.users?
SELECT COUNT(*) as total_users FROM auth.users;

-- Test 2: Can we see the email column?
SELECT email FROM auth.users LIMIT 1;

-- Test 3: Check if email column exists and is accessible
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth'
AND table_name = 'users'
AND column_name = 'email';

-- ============================================================
-- If any of these fail, there's a permission/database issue
-- ============================================================

