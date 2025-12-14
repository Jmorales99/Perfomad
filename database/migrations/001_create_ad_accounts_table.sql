-- Migration: Create ad_accounts table
-- Description: Stores connected advertising accounts from Plai for each user

CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google_ads', 'linkedin')),
  
  -- Plai-related IDs
  plai_user_id TEXT NOT NULL,  -- The userId from Plai API
  
  -- Platform account info (from Plai's get_connected_accounts_data)
  platform_account_id TEXT NOT NULL,  -- e.g., "act_123456" for Meta
  account_name TEXT,
  currency TEXT DEFAULT 'USD',
  
  -- Connection status
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  
  -- Raw data from Plai (store full response for reference)
  plai_account_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, platform, platform_account_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_ad_accounts_user_id ON ad_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_user_platform ON ad_accounts(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_plai_user_id ON ad_accounts(plai_user_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_is_active ON ad_accounts(is_active);

-- Add comment to table
COMMENT ON TABLE ad_accounts IS 'Stores connected advertising accounts from Plai API';
COMMENT ON COLUMN ad_accounts.plai_user_id IS 'User ID from Plai API system';
COMMENT ON COLUMN ad_accounts.platform_account_id IS 'Account ID from the advertising platform (e.g., Meta act_123456)';
COMMENT ON COLUMN ad_accounts.plai_account_data IS 'Raw JSON data from Plai API for this account';
