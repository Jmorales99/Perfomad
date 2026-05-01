-- Add 'google_merchant_center' to platform CHECK constraints.
-- Run this in Supabase SQL Editor.

-- oauth_states
ALTER TABLE public.oauth_states DROP CONSTRAINT IF EXISTS oauth_states_platform_check;
ALTER TABLE public.oauth_states ADD CONSTRAINT oauth_states_platform_check
  CHECK (platform = ANY (ARRAY[
    'meta'::text, 'google_ads'::text, 'linkedin'::text,
    'tiktok'::text, 'youtube'::text, 'google_merchant_center'::text
  ]));

-- ad_accounts (may also have a constraint)
ALTER TABLE public.ad_accounts DROP CONSTRAINT IF EXISTS ad_accounts_platform_check;
ALTER TABLE public.ad_accounts ADD CONSTRAINT ad_accounts_platform_check
  CHECK (platform = ANY (ARRAY[
    'meta'::text, 'google_ads'::text, 'linkedin'::text,
    'tiktok'::text, 'youtube'::text, 'google_merchant_center'::text
  ]));
