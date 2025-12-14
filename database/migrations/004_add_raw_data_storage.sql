-- Migration: Add raw data storage for campaign metrics
-- Description: Store raw API responses (Plai, Meta, Google Ads) and calculate metrics from stored data

-- ============================================================
-- 1. Add raw_data_plai column to campaigns table
-- ============================================================
-- This stores the RAW response from Plai API (or any future source)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' AND column_name = 'raw_data_plai'
  ) THEN
    ALTER TABLE campaigns 
    ADD COLUMN raw_data_plai JSONB;
    
    COMMENT ON COLUMN campaigns.raw_data_plai IS 'Raw API response data from Plai (or other source). Used to calculate metrics independently.';
  END IF;
END $$;

-- ============================================================
-- 2. Update campaign_metrics_history to store raw_data properly
-- ============================================================
-- Ensure raw_data column can store full API responses
COMMENT ON COLUMN campaign_metrics_history.raw_data IS 'Raw API response data used to calculate metrics. Format depends on source (Plai, Meta, Google Ads, etc.)';

-- ============================================================
-- 3. Add index for querying campaigns by sync status
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_campaigns_sync_status ON campaigns(sync_status) WHERE sync_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_last_synced ON campaigns(last_synced_at) WHERE last_synced_at IS NOT NULL;

