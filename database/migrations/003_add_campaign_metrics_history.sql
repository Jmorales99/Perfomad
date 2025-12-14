-- Migration: Add campaign metrics history and insights storage
-- Description: Enables storing all metrics and insights locally for system independence

-- ============================================================
-- 1. Campaign Metrics History Table (Time-Series Data)
-- ============================================================
-- Stores historical snapshots of campaign metrics for analytics
CREATE TABLE IF NOT EXISTS campaign_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
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
  
  -- Raw data from API (for future reference)
  raw_data JSONB,
  
  -- Indexes for fast queries
  CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_campaign_id ON campaign_metrics_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_recorded_at ON campaign_metrics_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_campaign_platform ON campaign_metrics_history(campaign_id, platform);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_history_campaign_date ON campaign_metrics_history(campaign_id, recorded_at DESC);

-- ============================================================
-- 2. Campaign Insights Table (Store Insights Locally)
-- ============================================================
-- Stores campaign insights and recommendations
CREATE TABLE IF NOT EXISTS campaign_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Insight Data (from Plai API or calculated)
  insights_data JSONB NOT NULL, -- Full insights object from API
  recommendations JSONB, -- Array of recommendation objects
  
  -- Metadata
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_source TEXT DEFAULT 'plai_api', -- 'plai_api', 'calculated', 'hybrid'
  is_stale BOOLEAN DEFAULT false, -- Mark if data is old
  
  -- For deduplication - only one active insight per campaign
  UNIQUE(campaign_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_insights_campaign_id ON campaign_insights(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_insights_calculated_at ON campaign_insights(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_insights_stale ON campaign_insights(is_stale) WHERE is_stale = true;

-- ============================================================
-- 3. Add last_synced_at to campaigns table
-- ============================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' AND column_name = 'last_synced_at'
  ) THEN
    ALTER TABLE campaigns 
    ADD COLUMN last_synced_at TIMESTAMPTZ;
    
    CREATE INDEX IF NOT EXISTS idx_campaigns_last_synced_at ON campaigns(last_synced_at);
  END IF;
END $$;

-- ============================================================
-- 4. Add sync_status to campaigns table (optional but useful)
-- ============================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' AND column_name = 'sync_status'
  ) THEN
    ALTER TABLE campaigns 
    ADD COLUMN sync_status TEXT DEFAULT 'pending'; -- 'pending', 'syncing', 'synced', 'error'
  END IF;
END $$;

-- ============================================================
-- 5. Comments for documentation
-- ============================================================
COMMENT ON TABLE campaign_metrics_history IS 'Historical time-series data of campaign metrics. Each row is a snapshot at a specific time.';
COMMENT ON TABLE campaign_insights IS 'Stored campaign insights and recommendations. Enables offline access and faster loading.';
COMMENT ON COLUMN campaigns.last_synced_at IS 'Timestamp of last successful metrics sync from Plai API';
COMMENT ON COLUMN campaigns.sync_status IS 'Current sync status: pending, syncing, synced, error';

COMMENT ON COLUMN campaign_metrics_history.platform IS 'Platform name if metrics are per-platform, NULL if aggregated';
COMMENT ON COLUMN campaign_metrics_history.raw_data IS 'Raw JSON data from API for future reference or additional metrics';

