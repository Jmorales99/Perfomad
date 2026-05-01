CREATE TABLE IF NOT EXISTS product_analysis_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL,
  run_at         timestamptz NOT NULL DEFAULT now(),
  model          text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  summary        text,
  products_count integer NOT NULL DEFAULT 0,
  input_hash     text,
  UNIQUE (user_id, client_id, input_hash)
);

CREATE TABLE IF NOT EXISTS product_recommendations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES product_analysis_runs(id) ON DELETE CASCADE,
  product_id     text NOT NULL,
  product_title  text,
  image_url      text,
  priority       text NOT NULL,
  action_type    text NOT NULL,
  title          text NOT NULL,
  description    text NOT NULL,
  rationale      text,
  impact         text
);

CREATE INDEX IF NOT EXISTS product_analysis_runs_user_client
  ON product_analysis_runs (user_id, client_id, run_at DESC);

CREATE INDEX IF NOT EXISTS product_recommendations_run_id
  ON product_recommendations (run_id);

ALTER TABLE product_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own product_analysis_runs"
  ON product_analysis_runs FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "users own product_recommendations"
  ON product_recommendations FOR ALL
  USING (
    run_id IN (
      SELECT id FROM product_analysis_runs WHERE user_id = auth.uid()
    )
  );
