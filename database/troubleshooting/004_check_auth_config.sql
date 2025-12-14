-- ============================================================
-- CHECK SUPABASE AUTH CONFIGURATION
-- ============================================================
-- This checks if there are any issues preventing Auth from working
-- ============================================================

-- 1. Check if we can query auth.users (should work)
SELECT COUNT(*) as user_count FROM auth.users;

-- 2. Check if there are any functions that might interfere
SELECT 
  routine_name,
  routine_type,
  routine_schema
FROM information_schema.routines
WHERE routine_schema IN ('auth', 'public')
AND routine_name IN ('email', 'check_email', 'verify_email', 'user_exists');

-- 3. Check for any constraints on auth.users
SELECT 
  constraint_name,
  constraint_type,
  table_name
FROM information_schema.table_constraints
WHERE table_schema = 'auth'
AND table_name = 'users';

-- 4. Check if profiles table has any triggers that might interfere
SELECT 
  trigger_name,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'profiles'
AND event_object_schema = 'public';

-- 5. Check RLS on profiles (should be enabled but not blocking)
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'profiles';

-- ============================================================
-- If query #1 fails, there's a permission issue
-- If query #2 shows functions, they might be interfering
-- If query #4 shows triggers on profiles, they might cause issues
-- ============================================================

