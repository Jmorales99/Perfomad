CREATE TABLE product_metrics_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id   uuid NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  campaign_id     uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  platform        text NOT NULL,
  product_id      text NOT NULL,
  product_title   text,
  recorded_at     date NOT NULL,
  impressions     integer NOT NULL DEFAULT 0,
  clicks          integer NOT NULL DEFAULT 0,
  spend           numeric(12,4) NOT NULL DEFAULT 0,
  conversions     numeric(10,4) NOT NULL DEFAULT 0,
  revenue         numeric(12,4) NOT NULL DEFAULT 0,
  ctr             numeric(8,6) NOT NULL DEFAULT 0,
  cpc             numeric(10,4) NOT NULL DEFAULT 0,
  roas            numeric(10,4) NOT NULL DEFAULT 0,
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id, ad_account_id, platform, product_id, recorded_at)
);

CREATE INDEX ON product_metrics_history (user_id, client_id, platform, recorded_at DESC);
CREATE INDEX ON product_metrics_history (campaign_id, recorded_at DESC);
CREATE INDEX ON product_metrics_history (product_id);

ALTER TABLE public.product_metrics_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own product metrics" ON public.product_metrics_history;

CREATE POLICY "Users manage own product metrics"
  ON public.product_metrics_history
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
