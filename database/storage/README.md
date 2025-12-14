# 📦 Storage Setup

## Quick Setup

### Option 1: SQL Script (Recommended)

Run in Supabase SQL Editor:
```sql
-- File: database/storage/001_create_storage_buckets.sql
```

This creates:
- ✅ `perfomad-images` bucket
- ✅ `campaign-images` bucket  
- ✅ All necessary policies

### Option 2: Dashboard (Manual)

1. Go to **Storage** → **New bucket**
2. Create: `perfomad-images` (public)
3. Create: `campaign-images` (public)

Then set up policies manually in Storage → Policies.

## What Gets Created

**Buckets:**
- `perfomad-images` - User uploaded images
- `campaign-images` - Campaign images

**Policies:**
- Users can upload/view/delete their own images
- Campaign images accessible to authenticated users

## After Setup

Try uploading an image again - it should work! ✅

