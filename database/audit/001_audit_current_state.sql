-- ============================================================
-- AUDIT: What Do We Actually Have?
-- ============================================================
-- Let's see what tables, triggers, and functions exist
-- ============================================================

-- 1. List ALL tables in public schema
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. List ALL triggers on auth.users
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'users'
AND event_object_schema = 'auth';

-- 3. List custom functions in public schema (excluding built-in ones)
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name NOT IN ('email') -- Exclude built-in functions
AND (
  routine_name LIKE '%user%' 
  OR routine_name LIKE '%profile%' 
  OR routine_name LIKE '%email%'
  OR routine_name LIKE '%campaign%'
);

-- 4. Check if profiles table exists and its structure
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'profiles'
ORDER BY ordinal_position;

-- ============================================================
-- This will show us what we actually have vs what we need
-- ============================================================

