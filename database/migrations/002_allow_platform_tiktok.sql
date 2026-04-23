-- Allow `tiktok` as a platform value for ad_accounts and oauth_states.
-- Apply only if your schema uses a CHECK constraint or enum; adjust names to match your Supabase project.

-- Example: PostgreSQL enum (uncomment and replace enum type name if applicable)
-- ALTER TYPE platform ADD VALUE IF NOT EXISTS 'tiktok';

-- Example: drop/recreate check constraint on ad_accounts.platform (adjust constraint name from your DB)
-- ALTER TABLE public.ad_accounts DROP CONSTRAINT IF EXISTS ad_accounts_platform_check;
-- ALTER TABLE public.ad_accounts ADD CONSTRAINT ad_accounts_platform_check
--   CHECK (platform = ANY (ARRAY['meta'::text, 'google_ads'::text, 'linkedin'::text, 'tiktok'::text]));

-- If `platform` is plain text with no constraint, no migration is required.
