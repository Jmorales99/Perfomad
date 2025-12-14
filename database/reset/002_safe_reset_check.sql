-- ============================================================
-- SAFE RESET CHECK - Run this FIRST to see what will be deleted
-- ============================================================
-- This shows you what data exists before reset
-- Review this BEFORE running the actual reset
-- ============================================================

-- Check what data exists
SELECT 
  'Users' as table_name,
  COUNT(*) as record_count,
  'auth.users (will be KEPT)' as note
FROM auth.users

UNION ALL

SELECT 
  'Profiles' as table_name,
  COUNT(*) as record_count,
  'Will be reset (subscription data cleared)' as note
FROM profiles

UNION ALL

SELECT 
  'Campaigns' as table_name,
  COUNT(*) as record_count,
  'Will be DELETED' as note
FROM campaigns

UNION ALL

SELECT 
  'Ad Accounts' as table_name,
  COUNT(*) as record_count,
  'Will be DELETED' as note
FROM ad_accounts

UNION ALL

SELECT 
  'Metrics History' as table_name,
  COUNT(*) as record_count,
  'Will be DELETED' as note
FROM campaign_metrics_history

UNION ALL

SELECT 
  'Insights' as table_name,
  COUNT(*) as record_count,
  'Will be DELETED' as note
FROM campaign_insights

ORDER BY table_name;

-- Show existing users
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================
-- Review the results above
-- If you're okay with deleting the data, run: 001_reset_all_data.sql
-- ============================================================

