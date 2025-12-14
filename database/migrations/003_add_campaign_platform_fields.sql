-- Migration: Add platform-specific fields to campaigns table
-- Description: Adds Meta/Google/LinkedIn specific campaign fields

-- Add platform-specific fields for campaigns
DO $$
BEGIN
  -- Add lifetime_budget if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'lifetime_budget') THEN
    ALTER TABLE campaigns ADD COLUMN lifetime_budget NUMERIC(10, 2);
    RAISE NOTICE 'Added column: lifetime_budget';
  END IF;

  -- Add objective if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'objective') THEN
    ALTER TABLE campaigns ADD COLUMN objective TEXT;
    RAISE NOTICE 'Added column: objective';
  END IF;

  -- Add billing_event if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'billing_event') THEN
    ALTER TABLE campaigns ADD COLUMN billing_event TEXT;
    RAISE NOTICE 'Added column: billing_event';
  END IF;

  -- Add bid_strategy if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'bid_strategy') THEN
    ALTER TABLE campaigns ADD COLUMN bid_strategy TEXT;
    RAISE NOTICE 'Added column: bid_strategy';
  END IF;

  -- Add special_ad_categories if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'special_ad_categories') THEN
    ALTER TABLE campaigns ADD COLUMN special_ad_categories TEXT[];
    RAISE NOTICE 'Added column: special_ad_categories';
  END IF;

  -- Add platform_settings if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'platform_settings') THEN
    ALTER TABLE campaigns ADD COLUMN platform_settings JSONB;
    RAISE NOTICE 'Added column: platform_settings';
  END IF;
END $$;

-- Add comments
COMMENT ON COLUMN campaigns.lifetime_budget IS 'Lifetime budget (alternative to daily budget_usd)';
COMMENT ON COLUMN campaigns.objective IS 'Campaign objective (Meta: OUTCOME_TRAFFIC, OUTCOME_SALES, etc.)';
COMMENT ON COLUMN campaigns.billing_event IS 'Billing event (Meta: IMPRESSIONS, LINK_CLICKS, etc.)';
COMMENT ON COLUMN campaigns.bid_strategy IS 'Bid strategy (Meta: LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.)';
COMMENT ON COLUMN campaigns.special_ad_categories IS 'Special ad categories array (Meta: HOUSING, EMPLOYMENT, CREDIT)';
COMMENT ON COLUMN campaigns.platform_settings IS 'Platform-specific settings stored as JSONB for flexibility';

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Run this migration to add platform-specific campaign fields
-- These fields are required for realistic campaign creation
-- ============================================================

