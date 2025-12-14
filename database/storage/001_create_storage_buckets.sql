-- ============================================================
-- CREATE STORAGE BUCKETS
-- ============================================================
-- Creates the required Storage buckets for images
-- ============================================================

-- 1. Create perfomad-images bucket (for general user images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('perfomad-images', 'perfomad-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Create campaign-images bucket (for campaign images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-images', 'campaign-images', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STORAGE POLICIES
-- ============================================================
-- Set up policies so users can manage their own images
-- ============================================================

-- Policy: Users can upload images to their own folder
CREATE POLICY "Users can upload their own images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'perfomad-images' 
  AND (storage.foldername(name))[1] = ('user_' || auth.uid()::text)
);

-- Policy: Users can view their own images
CREATE POLICY "Users can view their own images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'perfomad-images'
  AND (storage.foldername(name))[1] = ('user_' || auth.uid()::text)
);

-- Policy: Users can delete their own images
CREATE POLICY "Users can delete their own images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'perfomad-images'
  AND (storage.foldername(name))[1] = ('user_' || auth.uid()::text)
);

-- Policies for campaign-images bucket
CREATE POLICY "Users can upload campaign images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'campaign-images'
);

CREATE POLICY "Users can view campaign images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'campaign-images'
);

CREATE POLICY "Users can delete campaign images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'campaign-images'
);

-- ============================================================
-- DONE! ✅
-- ============================================================
-- Buckets created:
-- ✅ perfomad-images (public)
-- ✅ campaign-images (public)
-- 
-- Policies configured:
-- ✅ Users can upload/view/delete their own images
-- ✅ Campaign images accessible to authenticated users
-- ============================================================

