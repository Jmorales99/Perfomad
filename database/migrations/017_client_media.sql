-- Biblioteca de creativos por marca (client_media)
-- Cada asset (imagen o video) pertenece a un client_id específico.
-- La tabla campaign_images sigue existiendo como registro de uso (campaña↔archivo).

CREATE TABLE public.client_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_media_user_client ON public.client_media(user_id, client_id);
CREATE INDEX idx_client_media_client ON public.client_media(client_id);
CREATE UNIQUE INDEX idx_client_media_path ON public.client_media(storage_path);

ALTER TABLE public.client_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own media"
  ON public.client_media
  FOR ALL
  USING (auth.uid() = user_id);

-- Agregar media_type a campaign_images para trazabilidad
ALTER TABLE public.campaign_images
  ADD COLUMN IF NOT EXISTS media_type TEXT CHECK (media_type IN ('image', 'video'));
