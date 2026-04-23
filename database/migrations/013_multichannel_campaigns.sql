-- ─────────────────────────────────────────────────────────────────────────────
-- 013_multichannel_campaigns.sql
-- Introduce la entidad padre para campañas multicanal y tracking de estado
-- por plataforma en la tabla campaigns existente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabla padre: multichannel_campaigns
CREATE TABLE multichannel_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id        UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  objective        TEXT,
  status           TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'publishing', 'active', 'paused', 'partial_failed', 'completed', 'archived')),
  total_budget_usd NUMERIC,
  currency         TEXT        NOT NULL DEFAULT 'USD',
  platforms        TEXT[]      NOT NULL DEFAULT '{}',
  start_date       TEXT,
  end_date         TEXT,
  created_by       UUID        NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at     TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ,

  CONSTRAINT chk_mc_total_budget CHECK (total_budget_usd IS NULL OR total_budget_usd >= 0),
  CONSTRAINT chk_mc_dates        CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_mc_user_client_status
  ON multichannel_campaigns (user_id, client_id, status, created_at DESC);

CREATE INDEX idx_mc_client_id
  ON multichannel_campaigns (client_id);

-- 2. FK nullable en campaigns → multichannel_campaigns
ALTER TABLE campaigns
  ADD COLUMN multichannel_campaign_id UUID
    REFERENCES multichannel_campaigns(id) ON DELETE SET NULL;

CREATE INDEX idx_campaigns_multichannel_id
  ON campaigns (multichannel_campaign_id)
  WHERE multichannel_campaign_id IS NOT NULL;

-- 3. Estado por plataforma en campaigns
--    Forma: { "meta": "active", "google_ads": "paused" }
--    Valores: "pending" | "publishing" | "active" | "paused" | "failed" | "completed"
ALTER TABLE campaigns
  ADD COLUMN platform_status JSONB NOT NULL DEFAULT '{}';

-- 4. Trigger updated_at para multichannel_campaigns
CREATE OR REPLACE FUNCTION set_mc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mc_updated_at
  BEFORE UPDATE ON multichannel_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_mc_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (ejecutar en orden inverso si se necesita revertir):
--
-- DROP TRIGGER IF EXISTS trg_mc_updated_at ON multichannel_campaigns;
-- DROP FUNCTION IF EXISTS set_mc_updated_at();
-- ALTER TABLE campaigns DROP COLUMN IF EXISTS platform_status;
-- ALTER TABLE campaigns DROP COLUMN IF EXISTS multichannel_campaign_id;
-- DROP TABLE IF EXISTS multichannel_campaigns;
-- ─────────────────────────────────────────────────────────────────────────────
