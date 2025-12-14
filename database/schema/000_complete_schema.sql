-- ============================================================
-- COMPLETE DATABASE SCHEMA - FRESH START
-- ============================================================
-- This creates all tables from scratch
-- Run this if starting fresh or want to reset everything
-- 
-- IMPORTANT NOTES:
-- - This does NOT delete auth.users (email confirmation preserved)
-- - This uses CREATE TABLE IF NOT EXISTS (safe to run multiple times)
-- - Email confirmation is handled by Supabase Auth (auth.users table)
-- - See: database/schema/001_email_confirmation_trigger.sql for auto profile creation
-- ============================================================

-- ============================================================
-- 1. PROFILES TABLE
-- ============================================================
-- User profiles with subscription information
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  age INTEGER,
  phone TEXT,
  
  -- Subscription Management
  has_active_subscription BOOLEAN DEFAULT false,
  subscription_start TIMESTAMPTZ,
  subscription_expires TIMESTAMPTZ,
  has_completed_onboarding BOOLEAN DEFAULT false,
  
  -- Plai Integration
  plai_user_id TEXT, -- User ID in Plai system
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_plai_user_id ON profiles(plai_user_id) WHERE plai_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_subscription ON profiles(has_active_subscription) WHERE has_active_subscription = true;

-- Comments
COMMENT ON TABLE profiles IS 'User profiles with subscription and Plai integration information';
COMMENT ON COLUMN profiles.plai_user_id IS 'User ID from Plai API system';
COMMENT ON COLUMN profiles.subscription_expires IS 'Subscription expiry date. Used to verify active subscriptions.';

-- ============================================================
-- 2. AD_ACCOUNTS TABLE
-- ============================================================
-- Connected advertising accounts (Meta, Google Ads, LinkedIn)
CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Platform Information
  platform TEXT NOT NULL, -- 'meta', 'google_ads', 'linkedin'
  platform_account_id TEXT NOT NULL, -- External account ID (e.g., 'act_123456')
  account_name TEXT,
  currency TEXT DEFAULT 'USD',
  
  -- Plai Integration
  plai_user_id TEXT, -- User ID in Plai (from profiles)
  
  -- Connection Status
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  
  -- Raw Data
  plai_account_data JSONB, -- Raw response from Plai API
  
  -- Constraints
  UNIQUE(user_id, platform, platform_account_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ad_accounts_user_id ON ad_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform ON ad_accounts(platform, is_active);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_user_platform ON ad_accounts(user_id, platform, is_active);

-- Comments
COMMENT ON TABLE ad_accounts IS 'Connected advertising accounts from Meta, Google Ads, LinkedIn via Plai';
COMMENT ON COLUMN ad_accounts.platform_account_id IS 'External account ID from the platform (e.g., Meta act_123456)';
COMMENT ON COLUMN ad_accounts.plai_account_data IS 'Raw JSON data from Plai API for account information';

-- ============================================================
-- 3. CAMPAIGNS TABLE (Main Table)
-- ============================================================
-- Campaigns created by users
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Campaign Basic Info
  name TEXT NOT NULL,
  description TEXT,
  platforms TEXT[] NOT NULL, -- Array: ['meta', 'google_ads']
  number INTEGER, -- Campaign number per user (for display)
  
  -- Budget & Spending
  budget_usd NUMERIC(10, 2) DEFAULT 0, -- Daily budget
  lifetime_budget NUMERIC(10, 2), -- Lifetime budget (alternative to daily)
  spend_usd NUMERIC(10, 2) DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed'
  
  -- Dates
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Meta/Facebook Ads Specific Fields
  objective TEXT, -- OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_ENGAGEMENT, etc.
  billing_event TEXT, -- IMPRESSIONS, LINK_CLICKS, etc.
  bid_strategy TEXT, -- LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
  special_ad_categories TEXT[], -- ['HOUSING', 'EMPLOYMENT', 'CREDIT']
  
  -- Google Ads Specific Fields (can be added later)
  campaign_type TEXT, -- SEARCH, DISPLAY, VIDEO, etc.
  advertising_channel_type TEXT,
  
  -- LinkedIn Ads Specific Fields (can be added later)
  linkedin_campaign_format TEXT, -- SINGLE_IMAGE_AD, CAROUSEL_AD, etc.
  
  -- Platform-specific settings (JSONB for flexibility)
  platform_settings JSONB, -- Store platform-specific config: {"meta": {...}, "google_ads": {...}}
  
  -- Plai Integration
  mock_campaign_id JSONB, -- {"meta": "camp_123", "google_ads": "camp_456"}
  
  -- RAW DATA (Source of Truth) ⭐
  raw_data_plai JSONB, -- RAW response from Plai API
  
  -- CALCULATED METRICS (Quick Access) ⭐
  mock_stats JSONB, -- Calculated metrics from raw_data_plai
  
  -- Sync Tracking
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'pending' -- 'pending', 'syncing', 'synced', 'error'
);

-- Add missing columns if table already exists (for migration)
DO $$
BEGIN
  -- Add raw_data_plai if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'raw_data_plai') THEN
    ALTER TABLE campaigns ADD COLUMN raw_data_plai JSONB;
    RAISE NOTICE 'Added column: raw_data_plai';
  END IF;

  -- Add last_synced_at if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'last_synced_at') THEN
    ALTER TABLE campaigns ADD COLUMN last_synced_at TIMESTAMPTZ;
    RAISE NOTICE 'Added column: last_synced_at';
  END IF;

  -- Add sync_status if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'sync_status') THEN
    ALTER TABLE campaigns ADD COLUMN sync_status TEXT DEFAULT 'pending';
    RAISE NOTICE 'Added column: sync_status';
  END IF;

  -- Add mock_stats if it doesn't exist (for calculated metrics)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'mock_stats') THEN
    ALTER TABLE campaigns ADD COLUMN mock_stats JSONB;
    RAISE NOTICE 'Added column: mock_stats';
  END IF;

  -- Add platform-specific fields for Meta/Google/LinkedIn
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'lifetime_budget') THEN
    ALTER TABLE campaigns ADD COLUMN lifetime_budget NUMERIC(10, 2);
    RAISE NOTICE 'Added column: lifetime_budget';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'objective') THEN
    ALTER TABLE campaigns ADD COLUMN objective TEXT;
    RAISE NOTICE 'Added column: objective';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'billing_event') THEN
    ALTER TABLE campaigns ADD COLUMN billing_event TEXT;
    RAISE NOTICE 'Added column: billing_event';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'bid_strategy') THEN
    ALTER TABLE campaigns ADD COLUMN bid_strategy TEXT;
    RAISE NOTICE 'Added column: bid_strategy';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'special_ad_categories') THEN
    ALTER TABLE campaigns ADD COLUMN special_ad_categories TEXT[];
    RAISE NOTICE 'Added column: special_ad_categories';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'platform_settings') THEN
    ALTER TABLE campaigns ADD COLUMN platform_settings JSONB;
    RAISE NOTICE 'Added column: platform_settings';
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_status ON campaigns(user_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_created ON campaigns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_sync_status ON campaigns(sync_status) WHERE sync_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_last_synced ON campaigns(last_synced_at) WHERE last_synced_at IS NOT NULL;

-- Comments
COMMENT ON TABLE campaigns IS 'Marketing campaigns created by users';
COMMENT ON COLUMN campaigns.mock_campaign_id IS 'JSONB storing Plai campaign IDs. Format: {"meta": "camp_123", "google_ads": "camp_456"}';
COMMENT ON COLUMN campaigns.raw_data_plai IS 'RAW API response data from Plai (source of truth). Used to calculate metrics independently.';
COMMENT ON COLUMN campaigns.mock_stats IS 'Calculated metrics from raw_data_plai (for quick access). Includes CPA, ROA, total_sales, etc.';
COMMENT ON COLUMN campaigns.last_synced_at IS 'Timestamp of last successful metrics sync from Plai API';
COMMENT ON COLUMN campaigns.sync_status IS 'Current sync status: pending, syncing, synced, error';

-- ============================================================
-- 4. CAMPAIGN_IMAGES TABLE
-- ============================================================
-- Campaign images stored in Supabase Storage
CREATE TABLE IF NOT EXISTS campaign_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL, -- Path in Supabase Storage
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_images_campaign_id ON campaign_images(campaign_id);

-- Comments
COMMENT ON TABLE campaign_images IS 'Campaign images stored in Supabase Storage bucket';

-- ============================================================
-- 5. CAMPAIGN_METRICS_HISTORY TABLE (Time-Series)
-- ============================================================
-- Historical snapshots of campaign metrics
CREATE TABLE IF NOT EXISTS campaign_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Platform & Time
  platform TEXT, -- 'meta', 'google_ads', 'linkedin', or NULL for aggregated
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Core Metrics
  spend NUMERIC(10, 2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr NUMERIC(5, 4) DEFAULT 0, -- Decimal format (0.025 = 2.5%)
  
  -- Conversion Metrics
  conversions INTEGER DEFAULT 0,
  revenue NUMERIC(10, 2) DEFAULT 0,
  total_sales NUMERIC(10, 2) DEFAULT 0,
  
  -- Calculated Metrics
  cpa NUMERIC(10, 2), -- Cost Per Acquisition
  roa NUMERIC(5, 2), -- Return on Advertising
  cost_per_click NUMERIC(10, 2),
  cost_per_conversion NUMERIC(10, 2),
  cpm NUMERIC(10, 2), -- Cost Per 1000 Impressions
  reach INTEGER,
  
  -- RAW DATA (for future reference)
  raw_data JSONB -- Raw API response for this snapshot
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_campaign_id ON campaign_metrics_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_recorded_at ON campaign_metrics_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_campaign_platform ON campaign_metrics_history(campaign_id, platform);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_campaign_date ON campaign_metrics_history(campaign_id, recorded_at DESC);

-- Comments
COMMENT ON TABLE campaign_metrics_history IS 'Historical time-series data of campaign metrics. Each row is a snapshot at a specific time.';
COMMENT ON COLUMN campaign_metrics_history.platform IS 'Platform name if metrics are per-platform, NULL if aggregated';
COMMENT ON COLUMN campaign_metrics_history.raw_data IS 'Raw JSON data from API for future reference or additional metrics';

-- ============================================================
-- 6. CAMPAIGN_INSIGHTS TABLE (Cached Insights)
-- ============================================================
-- Stored campaign insights and recommendations
CREATE TABLE IF NOT EXISTS campaign_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Insights Data
  insights_data JSONB NOT NULL, -- Full insights object from Plai API
  recommendations JSONB, -- Array of recommendation objects
  
  -- Metadata
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_source TEXT DEFAULT 'plai_api', -- 'plai_api', 'calculated', 'hybrid'
  is_stale BOOLEAN DEFAULT false, -- Mark if data is old
  
  -- Only one active insight per campaign
  UNIQUE(campaign_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_insights_campaign_id ON campaign_insights(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_insights_calculated_at ON campaign_insights(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_insights_stale ON campaign_insights(is_stale) WHERE is_stale = true;

-- Comments
COMMENT ON TABLE campaign_insights IS 'Stored campaign insights and recommendations. Enables offline access and faster loading.';
COMMENT ON COLUMN campaign_insights.data_source IS 'Source of insights: plai_api, calculated, or hybrid';

-- ============================================================
-- 7. ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================
-- Enable RLS on all tables for security

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_insights ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. RLS POLICIES (Basic - Users can only access their own data)
-- ============================================================

-- Profiles: Users can only see/edit their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Ad Accounts: Users can only see/edit their own accounts
CREATE POLICY "Users can view own ad accounts" ON ad_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ad accounts" ON ad_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ad accounts" ON ad_accounts
  FOR UPDATE USING (auth.uid() = user_id);

-- Campaigns: Users can only see/edit their own campaigns
CREATE POLICY "Users can view own campaigns" ON campaigns
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own campaigns" ON campaigns
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own campaigns" ON campaigns
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own campaigns" ON campaigns
  FOR DELETE USING (auth.uid() = user_id);

-- Campaign Images: Inherit from campaigns
CREATE POLICY "Users can view own campaign images" ON campaign_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_images.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own campaign images" ON campaign_images
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_images.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Metrics History: Inherit from campaigns
CREATE POLICY "Users can view own metrics history" ON campaign_metrics_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_metrics_history.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Insights: Inherit from campaigns
CREATE POLICY "Users can view own insights" ON campaign_insights
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_insights.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- ============================================================
-- DONE! ✅
-- ============================================================


