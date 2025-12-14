-- ============================================================
-- LIST ALL TABLES: See What We Have
-- ============================================================
-- Run this to see all tables in your database
-- ============================================================

-- List ALL tables in public schema
SELECT 
  table_name,
  'public' as schema_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ============================================================
-- Expected Tables (what we need):
-- ============================================================
-- ✅ profiles          - User profiles with subscription info
-- ✅ ad_accounts       - Connected advertising accounts (Meta, Google, LinkedIn)
-- ✅ campaigns         - Marketing campaigns
-- ✅ campaign_images   - Campaign images (stored in Supabase Storage)
-- ✅ campaign_metrics_history - Historical snapshots of metrics
-- ✅ campaign_insights - Cached insights and recommendations
-- 
-- ✅ auth.users        - Built-in Supabase Auth (DON'T TOUCH)
-- ============================================================
-- If you see other tables, they might be old/unused
-- ============================================================

