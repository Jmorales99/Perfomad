-- Migration: Add platform_budgets column to campaigns table
-- Stores per-platform budget configuration as JSONB.
-- Shape: { "meta": { "budget_type": "daily" | "lifetime", "amount": number }, ... }
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS platform_budgets JSONB DEFAULT NULL;
