# 🗄️ Database Setup Guide

## 📋 Overview

This guide will help you set up your database from scratch with all the necessary tables, indexes, and security policies.

## 🚀 Quick Start (Fresh Installation)

### Step 1: Access Supabase SQL Editor

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 2: Run the Complete Schema

1. Open the file: `database/schema/000_complete_schema.sql`
2. Copy the entire contents
3. Paste into Supabase SQL Editor
4. Click **Run** (or press `Ctrl+Enter`)

**That's it!** All tables will be created automatically.

---

## 📊 What Gets Created

### Tables Created:

1. **`profiles`** - User profiles with subscription info
2. **`ad_accounts`** - Connected ad accounts (Meta, Google Ads, LinkedIn)
3. **`campaigns`** - Main campaigns table
4. **`campaign_images`** - Campaign images
5. **`campaign_metrics_history`** - Historical metrics snapshots
6. **`campaign_insights`** - Cached insights and recommendations

### Indexes Created:

- Performance indexes on all frequently queried columns
- Composite indexes for common query patterns
- Conditional indexes for filtered queries

### Security (RLS):

- Row Level Security enabled on all tables
- Policies ensure users can only access their own data
- Secure by default

---

## 🔍 Verify Installation

Run this query to verify all tables were created:

```sql
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'ad_accounts',
    'campaigns',
    'campaign_images',
    'campaign_metrics_history',
    'campaign_insights'
  )
ORDER BY table_name;
```

You should see all 6 tables with their column counts.

---

## 🔄 If You Already Have Data

### Option 1: Backup First (Recommended)

```sql
-- Backup existing data (run for each table)
CREATE TABLE profiles_backup AS SELECT * FROM profiles;
CREATE TABLE campaigns_backup AS SELECT * FROM campaigns;
-- etc...
```

### Option 2: Migrate Existing Data

If you have existing data, the schema uses `CREATE TABLE IF NOT EXISTS`, so existing tables won't be overwritten. However, you may need to:

1. **Add missing columns**:
   ```sql
   -- Example: Add raw_data_plai if it doesn't exist
   ALTER TABLE campaigns 
   ADD COLUMN IF NOT EXISTS raw_data_plai JSONB;
   ```

2. **Update existing data**:
   ```sql
   -- Example: Convert TEXT to JSONB for mock_campaign_id
   UPDATE campaigns 
   SET mock_campaign_id = json_build_object('legacy', mock_campaign_id)::jsonb
   WHERE mock_campaign_id IS NOT NULL 
     AND jsonb_typeof(mock_campaign_id::jsonb) IS NULL;
   ```

---

## 📝 Table Details

### `profiles` Table

```sql
profiles (
  id UUID PRIMARY KEY → auth.users(id)
  email, name, age, phone
  has_active_subscription BOOLEAN
  subscription_start, subscription_expires TIMESTAMPTZ
  plai_user_id TEXT
)
```

**Purpose**: User profiles with subscription tracking

---

### `ad_accounts` Table

```sql
ad_accounts (
  id UUID PRIMARY KEY
  user_id UUID → auth.users(id)
  platform TEXT ('meta', 'google_ads', 'linkedin')
  platform_account_id TEXT (e.g., 'act_123456')
  account_name, currency
  is_active BOOLEAN
  plai_account_data JSONB (raw data from Plai)
)
```

**Purpose**: Connected ad accounts from platforms via Plai

---

### `campaigns` Table (Main)

```sql
campaigns (
  id UUID PRIMARY KEY
  user_id UUID → auth.users(id)
  name, description, platforms[]
  budget_usd, spend_usd
  status ('active', 'paused', 'completed')
  start_date, end_date
  
  -- KEY COLUMNS ⭐
  mock_campaign_id JSONB -- Plai campaign IDs
  raw_data_plai JSONB -- RAW API response (source of truth)
  mock_stats JSONB -- Calculated metrics (quick access)
  
  last_synced_at TIMESTAMPTZ
  sync_status TEXT
)
```

**Purpose**: Main campaigns with RAW data and calculated metrics

---

### `campaign_metrics_history` Table

```sql
campaign_metrics_history (
  id UUID PRIMARY KEY
  campaign_id UUID → campaigns(id)
  platform TEXT
  recorded_at TIMESTAMPTZ
  
  -- Metrics (all numeric fields)
  spend, impressions, clicks, ctr
  conversions, revenue, total_sales
  cpa, roa, cost_per_click, cpm, reach
  
  raw_data JSONB -- RAW snapshot
)
```

**Purpose**: Time-series historical data (one row per sync)

---

### `campaign_insights` Table

```sql
campaign_insights (
  id UUID PRIMARY KEY
  campaign_id UUID → campaigns(id) UNIQUE
  insights_data JSONB
  recommendations JSONB
  calculated_at TIMESTAMPTZ
  data_source TEXT
  is_stale BOOLEAN
)
```

**Purpose**: Cached insights for fast loading

---

## 🔧 Common Operations

### Check Table Structure

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'campaigns'
ORDER BY ordinal_position;
```

### Check Indexes

```sql
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'campaigns'
ORDER BY tablename, indexname;
```

### Check RLS Policies

```sql
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

---

## 🐛 Troubleshooting

### Error: "relation already exists"

**Solution**: Tables already exist. The schema uses `IF NOT EXISTS`, so this is safe. If you want to recreate:

```sql
-- Drop tables (WARNING: Deletes all data!)
DROP TABLE IF EXISTS campaign_insights CASCADE;
DROP TABLE IF EXISTS campaign_metrics_history CASCADE;
DROP TABLE IF EXISTS campaign_images CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS ad_accounts CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Then re-run the schema
```

### Error: "permission denied"

**Solution**: Make sure you're using the Supabase SQL Editor (uses service role), not a regular user connection.

### Error: "foreign key constraint"

**Solution**: Tables must be created in order. The schema handles this automatically, but if you're creating manually, create in this order:

1. `profiles` (depends on `auth.users`)
2. `ad_accounts` (depends on `auth.users`)
3. `campaigns` (depends on `auth.users`)
4. `campaign_images` (depends on `campaigns`)
5. `campaign_metrics_history` (depends on `campaigns`)
6. `campaign_insights` (depends on `campaigns`)

---

## ✅ Post-Setup Checklist

- [ ] All 6 tables created successfully
- [ ] Indexes created (check with query above)
- [ ] RLS policies enabled
- [ ] Test insert/select/update operations
- [ ] Verify foreign keys work correctly

---

## 📚 Next Steps

After database setup:

1. **Run your backend application** - It should now work with the new schema
2. **Test campaign creation** - Create a test campaign
3. **Test sync** - Sync metrics and verify data is stored
4. **Check raw data** - Verify `raw_data_plai` is being populated

---

## 🆘 Need Help?

If you encounter issues:

1. Check Supabase logs in the dashboard
2. Verify you're using the SQL Editor (service role permissions)
3. Make sure all dependencies (like `auth.users`) exist
4. Check for typos in table/column names

---

**Database setup complete! 🎉**


