-- ============================================================
-- RESET APPLICATION DATA (KEEP AUTH USERS)
-- ============================================================
-- This script resets all application data but KEEPS auth.users
-- Email confirmation is handled by Supabase Auth (not this script)
-- 
-- WHAT IT DOES:
-- ✅ Deletes: campaigns, ad_accounts, metrics_history, insights
-- ✅ Resets: profiles (subscription data cleared)
-- ✅ KEEPS: auth.users (users can still log in, email confirmed)
-- 
-- WHAT HAPPENS TO EXISTING USERS:
-- - Can still log in (email already confirmed)
-- - Must reactivate subscription
-- - Must reconnect ad accounts
-- - All campaigns deleted (must create new ones)
-- ============================================================
-- ⚠️ WARNING: This will delete ALL application data!
-- 
-- FOR COMPLETE RESET (including users): Use 003_complete_reset_delete_users.sql
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

  -- Update profiles to reset subscription data (KEEP users in auth.users)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    UPDATE profiles SET
      has_active_subscription = false,
      subscription_start = NULL,
      subscription_expires = NULL,
      plai_user_id = NULL,
      has_completed_onboarding = false,
      updated_at = NOW();
    RAISE NOTICE 'Reset profiles subscription data';
  END IF;
END $$;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- ============================================================
-- STEP 2: Reset sequences (if any)
-- ============================================================
-- Campaign numbers will reset automatically on next creation

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify all data is cleared
DO $$
DECLARE
  campaigns_count INTEGER := 0;
  accounts_count INTEGER := 0;
  metrics_count INTEGER := 0;
  insights_count INTEGER := 0;
BEGIN
  -- Only check tables that exist
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
  RAISE NOTICE 'Reset complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Campaigns: %', campaigns_count;
  RAISE NOTICE 'Ad Accounts: %', accounts_count;
  RAISE NOTICE 'Metrics History: %', metrics_count;
  RAISE NOTICE 'Insights: %', insights_count;
  RAISE NOTICE 'Profiles remain but subscription data reset';
  RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Note: auth.users table is NOT touched
-- Users can still log in, but will need to:
-- - Re-confirm email (if not already confirmed)
-- - Reactivate subscription
-- - Reconnect ad accounts
-- ============================================================

