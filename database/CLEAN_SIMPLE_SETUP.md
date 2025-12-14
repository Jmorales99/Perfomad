# 🧹 Clean & Simple Setup Guide

## Philosophy
- **Use Supabase Auth natively** - No triggers, no interference
- **Keep only needed tables** - Simple and clean
- **Handle profile creation in code** - More reliable and easier to debug

## 📋 Tables We Need

1. **`profiles`** - User profiles with subscription info
2. **`ad_accounts`** - Connected advertising accounts
3. **`campaigns`** - Marketing campaigns
4. **`campaign_images`** - Campaign images
5. **`campaign_metrics_history`** - Historical metrics snapshots
6. **`campaign_insights`** - Cached insights

**Built-in (don't touch):**
- `auth.users` - Supabase Auth handles this

## 🚀 Setup Steps

### Step 1: Remove All Triggers

Run in Supabase SQL Editor:
```sql
-- File: database/cleanup/001_simple_cleanup.sql
```

This removes all triggers that interfere with Supabase Auth.

### Step 2: Check What Tables You Have

Run:
```sql
-- File: database/cleanup/002_list_all_tables.sql
```

See what tables exist. Compare with the list above.

### Step 3: Create/Fix Tables

Run:
```sql
-- File: database/schema/000_complete_schema.sql
```

This creates all needed tables with proper structure.

### Step 4: Delete Unnecessary Tables (if any)

If you see tables not in the list above, delete them:

```sql
-- Example: If you have an old table
DROP TABLE IF EXISTS old_table_name CASCADE;
```

### Step 5: Test

1. Try creating a user → Should work now!
2. Profile is created automatically by your code (RegisterUser.ts)
3. No triggers interfering with Auth

## ✅ How It Works Now

1. **User signs up** → Supabase Auth creates user in `auth.users` ✅
2. **Your code** → Creates profile in `profiles` table ✅
3. **No triggers** → Nothing interferes with Auth ✅

## 📝 Profile Creation

Profile creation happens in:
- `src/application/usecases/RegisterUser.ts`
- After user is created, it automatically creates profile
- Works for both dev and production

**No database triggers needed!** ✨

