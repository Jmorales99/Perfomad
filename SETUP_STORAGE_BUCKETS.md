# 📦 Setup Supabase Storage Buckets

## Problem
Error: "The related resource does not exist"
- Your code needs Storage buckets for images
- These buckets don't exist in your new Supabase project yet

## Required Buckets

Your code uses these buckets:
1. **`perfomad-images`** - For general user images
2. **`campaign-images`** - For campaign images (optional, can use same bucket)

## Step-by-Step Setup

### Step 1: Create Storage Bucket

1. Go to **Supabase Dashboard** → **Storage**
2. Click **"New bucket"** or **"Create bucket"**
3. Fill in:
   - **Name**: `perfomad-images`
   - **Public bucket**: ✅ **Check this** (allows public access)
   - Click **"Create bucket"**

### Step 2: Configure Bucket Settings

1. Click on the `perfomad-images` bucket
2. Go to **"Policies"** tab
3. You should see default policies, but verify:
   - Users can upload their own files
   - Users can read files
   - Users can delete their own files

### Step 3: (Optional) Create Campaign Images Bucket

If you want separate bucket for campaigns:
1. Create another bucket: `campaign-images`
2. Set as **Public bucket**
3. Same policies

**OR** you can use the same `perfomad-images` bucket for everything (simpler!)

### Step 4: Test

After creating the bucket:
1. Try uploading an image again
2. Should work now! ✅

## Quick SQL Alternative (Advanced)

If you prefer SQL, you can create buckets via SQL Editor:

```sql
-- Create perfomad-images bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('perfomad-images', 'perfomad-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create campaign-images bucket (optional)
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-images', 'campaign-images', true)
ON CONFLICT (id) DO NOTHING;
```

**Then set up policies** (see below)

## Storage Policies Setup

After creating buckets, set up policies in **Storage** → **Policies**:

### For `perfomad-images` bucket:

**Policy 1: Allow authenticated users to upload**
```sql
CREATE POLICY "Users can upload their own images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'perfomad-images' 
  AND (storage.foldername(name))[1] = ('user_' || auth.uid()::text)
);
```

**Policy 2: Allow users to read their images**
```sql
CREATE POLICY "Users can view their own images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'perfomad-images'
  AND (storage.foldername(name))[1] = ('user_' || auth.uid()::text)
);
```

**Policy 3: Allow users to delete their images**
```sql
CREATE POLICY "Users can delete their own images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'perfomad-images'
  AND (storage.foldername(name))[1] = ('user_' || auth.uid()::text)
);
```

## ✅ Quick Solution

**Fastest way:**
1. Go to **Storage** → **New bucket**
2. Name: `perfomad-images`
3. Check **"Public bucket"**
4. Click **"Create"**
5. Done! ✅

The default policies should work, but if not, add the policies above.

