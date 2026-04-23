-- =============================================================================
-- MIGRATION 001: Clients table triggers
-- Ejecutar en Supabase SQL Editor en este orden (todo el script de una vez).
-- Idempotente: usa CREATE OR REPLACE y DROP IF EXISTS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TRIGGER 1: Prevent deleting the last client (brand) of a user
-- Fires BEFORE DELETE on public.clients.
-- Raises exception errcode '45000' if the row to delete is the user's last one.
-- The backend usecase already enforces this; this trigger is a DB-level safety net.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_last_client_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM public.clients
    WHERE user_id = OLD.user_id
  ) <= 1 THEN
    RAISE EXCEPTION 'cannot_delete_last_brand'
      USING ERRCODE = '45000',
            DETAIL  = 'A user must always have at least one brand.',
            HINT    = 'Create another brand before deleting this one.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_client_deletion ON public.clients;
CREATE TRIGGER trg_prevent_last_client_deletion
  BEFORE DELETE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_client_deletion();

-- -----------------------------------------------------------------------------
-- TRIGGER 2: Auto-create "Default" client after a new profile is inserted.
-- Fires AFTER INSERT on public.profiles.
-- Uses ON CONFLICT DO NOTHING to be fully idempotent.
-- SECURITY DEFINER so the function runs with owner privileges, bypassing RLS.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_default_client_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.clients (user_id, name, description)
  VALUES (NEW.id, 'Default', NULL)
  ON CONFLICT (user_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_default_client ON public.profiles;
CREATE TRIGGER trg_create_default_client
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_client_for_user();

-- -----------------------------------------------------------------------------
-- Verification queries (run manually to confirm triggers are active):
-- -----------------------------------------------------------------------------
-- SELECT tgname, tgrelid::regclass, tgenabled
-- FROM pg_trigger
-- WHERE tgname IN ('trg_prevent_last_client_deletion', 'trg_create_default_client');
