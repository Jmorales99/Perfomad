-- Track per-account OAuth health so the frontend can prompt reconnection
-- without waiting for a full sync to surface the error.
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'connected'
    CHECK (connection_status IN ('connected', 'reconnect_required', 'error'));
