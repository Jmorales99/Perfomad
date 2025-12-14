-- ============================================================
-- COMPLETE RESET - DELETE EVERYTHING INCLUDING USERS
-- ============================================================
-- This script resets EVERYTHING including auth.users
-- Complete fresh start - all data deleted
-- ============================================================
-- ⚠️ WARNING: This will delete ALL data including users!
-- Only run if you want a complete fresh start
-- ============================================================

-- Disable triggers temporarily to avoid constraint issues
SET session_replication_role = 'replica';

-- ============================================================
-- STEP 1: Delete all application data (only from existing tables)
-- ============================================================
-- This will only delete from tables that exist, skipping missing ones

DO $$
BEGIN
  -- Delete insights first (references campaigns)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaign_insights') THEN
    DELETE FROM campaign_insights;
    RAISE NOTICE 'Deleted from campaign_insights';
  END IF;

  -- Delete metrics history (references campaigns)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaign_metrics_history') THEN
    DELETE FROM campaign_metrics_history;
    RAISE NOTICE 'Deleted from campaign_metrics_history';
  END IF;

  -- Delete campaign images (references campaigns)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaign_images') THEN
    DELETE FROM campaign_images;
    RAISE NOTICE 'Deleted from campaign_images';
  END IF;

  -- Delete campaigns (references users)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaigns') THEN
    DELETE FROM campaigns;
    RAISE NOTICE 'Deleted from campaigns';
  END IF;

  -- Delete ad accounts (references users)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ad_accounts') THEN
    DELETE FROM ad_accounts;
    RAISE NOTICE 'Deleted from ad_accounts';
  END IF;

  -- Delete profiles (references auth.users)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    DELETE FROM profiles;
    RAISE NOTICE 'Deleted from profiles';
  END IF;
END $$;

-- ============================================================
-- STEP 2: Delete all auth users
-- ============================================================
-- WARNING: This deletes ALL users from Supabase Auth
-- Users will need to sign up again

DELETE FROM auth.users;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- ============================================================
-- STEP 3: Reset sequences (if any)
-- ============================================================
-- Campaign numbers will reset automatically on next creation

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify all data is deleted
DO $$
DECLARE
  users_count INTEGER;
  profiles_count INTEGER := 0;
  campaigns_count INTEGER := 0;
  accounts_count INTEGER := 0;
  metrics_count INTEGER := 0;
  insights_count INTEGER := 0;
BEGIN
  -- Always check auth.users
  SELECT COUNT(*) INTO users_count FROM auth.users;
  
  -- Only check tables that exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    SELECT COUNT(*) INTO profiles_count FROM profiles;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaigns') THEN
    SELECT COUNT(*) INTO campaigns_count FROM campaigns;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ad_accounts') THEN
    SELECT COUNT(*) INTO accounts_count FROM ad_accounts;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaign_metrics_history') THEN
    SELECT COUNT(*) INTO metrics_count FROM campaign_metrics_history;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaign_insights') THEN
    SELECT COUNT(*) INTO insights_count FROM campaign_insights;
  END IF;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Complete Reset Results:';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Users (auth.users): %', users_count;
  RAISE NOTICE 'Profiles: %', profiles_count;
  RAISE NOTICE 'Campaigns: %', campaigns_count;
  RAISE NOTICE 'Ad Accounts: %', accounts_count;
  RAISE NOTICE 'Metrics History: %', metrics_count;
  RAISE NOTICE 'Insights: %', insights_count;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All data deleted! Ready for fresh start.';
  RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Everything is deleted. Now:
-- 1. Run: database/schema/000_complete_schema.sql
-- 2. Run: database/schema/001_email_confirmation_trigger.sql (recommended)
-- 3. Users can sign up fresh
-- 4. Email confirmation will be required for new signups
-- ============================================================

