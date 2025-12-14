-- Migration: Update profiles table to use plai_user_id instead of plai_mock_user_id
-- Description: Renames column for consistency and updates campaigns table for multi-platform support

-- First, add the new column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'plai_user_id'
  ) THEN
    -- If plai_mock_user_id exists, copy its data
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'profiles' AND column_name = 'plai_mock_user_id'
    ) THEN
      ALTER TABLE profiles 
      ADD COLUMN plai_user_id TEXT,
      ALTER COLUMN plai_user_id SET DEFAULT NULL;
      
      -- Copy existing data
      UPDATE profiles 
      SET plai_user_id = plai_mock_user_id 
      WHERE plai_mock_user_id IS NOT NULL;
    ELSE
      -- Just add the new column
      ALTER TABLE profiles 
      ADD COLUMN plai_user_id TEXT,
      ALTER COLUMN plai_user_id SET DEFAULT NULL;
    END IF;
  END IF;
END $$;

-- Update campaigns table to support JSONB for multi-platform campaign IDs
-- This allows storing multiple Plai campaign IDs per local campaign (one per platform)
DO $$ 
BEGIN
  -- Check if mock_campaign_id is already JSONB
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' 
    AND column_name = 'mock_campaign_id' 
    AND data_type = 'text'
  ) THEN
    -- Convert TEXT to JSONB (handle both string IDs and JSON strings)
    ALTER TABLE campaigns 
    ALTER COLUMN mock_campaign_id TYPE JSONB 
    USING CASE 
      WHEN mock_campaign_id IS NULL THEN NULL
      WHEN mock_campaign_id::text ~ '^\{.*\}$' THEN mock_campaign_id::jsonb  -- Already JSON
      ELSE json_build_object('legacy', mock_campaign_id)::jsonb  -- Single ID
    END;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' 
    AND column_name = 'mock_campaign_id'
  ) THEN
    -- Column doesn't exist, create it as JSONB
    ALTER TABLE campaigns 
    ADD COLUMN mock_campaign_id JSONB;
  END IF;
END $$;

-- Update mock_stats to be more flexible JSONB if it's not already
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' 
    AND column_name = 'mock_stats' 
    AND data_type != 'jsonb'
  ) THEN
    ALTER TABLE campaigns 
    ALTER COLUMN mock_stats TYPE JSONB 
    USING mock_stats::jsonb;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' 
    AND column_name = 'mock_stats'
  ) THEN
    ALTER TABLE campaigns 
    ADD COLUMN mock_stats JSONB;
  END IF;
END $$;

-- Add comments
COMMENT ON COLUMN profiles.plai_user_id IS 'User ID from Plai API (replaces plai_mock_user_id)';
COMMENT ON COLUMN campaigns.mock_campaign_id IS 'JSONB storing Plai campaign IDs. Format: {"meta": "camp_123", "google_ads": "camp_456"} or legacy single ID';
COMMENT ON COLUMN campaigns.mock_stats IS 'JSONB storing campaign metrics from Plai API. Can be per-platform or overall';
