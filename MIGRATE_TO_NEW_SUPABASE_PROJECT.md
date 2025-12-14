# 🚀 Migrate to New Supabase Project

## Why This Helps

If your current Supabase project has a corrupted `auth.identities` table or other database issues, creating a fresh project will solve it.

## Step-by-Step Migration

### Step 1: Create New Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click **"New Project"**
3. Fill in:
   - **Name**: `perfomad` (or any name)
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to you
   - Click **"Create new project"**

4. Wait 2-3 minutes for project to initialize

### Step 2: Get New API Keys

1. In your new project → **Settings** → **API**
2. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Publishable key** → `SUPABASE_PUBLISHABLE_KEY`
   - **Secret key** → `SUPABASE_SECRET_KEY`

### Step 3: Update Your .env File

Update these values in your `.env`:

```env
SUPABASE_URL=https://your-new-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-new-publishable-key
SUPABASE_SECRET_KEY=your-new-secret-key
```

### Step 4: Create Database Schema

In your new Supabase project → **SQL Editor**:

1. Run: `database/schema/000_complete_schema.sql`
   - Creates all tables (profiles, campaigns, etc.)
   - Creates indexes and RLS policies

2. **DO NOT** run the trigger script (we're handling profiles in code)

### Step 5: Configure Auth Settings

In **Authentication** → **Settings**:

1. **Email confirmations**: Toggle OFF (for dev)
2. **Confirm email**: Optional
3. Save

### Step 6: Test User Creation

1. Restart your server:
   ```bash
   npm run dev
   ```

2. Try creating a user through your API

3. Should work now! ✅

## What You Keep

✅ All your code (no changes needed)
✅ All your logic
✅ All your use cases

## What Changes

🔄 Only the `.env` file (new API keys)
🔄 Fresh database (clean slate)

## Benefits

- ✅ Fresh database (no corruption)
- ✅ Clean auth schema
- ✅ No legacy issues
- ✅ Everything works from scratch

## Optional: Copy Old Data (if needed)

If you need data from the old project:

1. Export from old project (if needed)
2. Import to new project (manual or via SQL)

But since you said you have no important data, just start fresh! 🎉

