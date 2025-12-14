# 🔄 Complete Reset & Setup Guide

## 🎯 Quick Start (Recommended)

Since you don't have important data, here's the fastest way to set everything up:

### Step 1: Reset Everything (Optional - if you have existing data)

```sql
-- Run in Supabase SQL Editor
-- File: database/reset/001_reset_all_data.sql
```

This will:
- Delete all campaigns, ad accounts, metrics
- Reset profile subscription data
- **KEEP auth.users** (email confirmation preserved)

### Step 2: Run Complete Schema

```sql
-- Run in Supabase SQL Editor
-- File: database/schema/000_complete_schema.sql
```

This creates all tables from scratch.

### Step 3: Setup Email Confirmation Trigger (Optional but Recommended)

```sql
-- Run in Supabase SQL Editor
-- File: database/schema/001_email_confirmation_trigger.sql
```

This ensures profiles are created automatically when users confirm their email.

---

## 📋 Complete Setup Checklist

### 1. Database Setup
- [ ] Run `database/schema/000_complete_schema.sql`
- [ ] Verify all 6 tables created
- [ ] (Optional) Run `database/reset/001_reset_all_data.sql` to clear old data
- [ ] (Recommended) Run `database/schema/001_email_confirmation_trigger.sql`

### 2. Supabase Auth Settings
- [ ] Go to **Authentication** → **Settings**
- [ ] Enable **Email confirmations** = ON
- [ ] Set **Confirm email** = Required
- [ ] Configure email templates

### 3. Test
- [ ] Create new user (should send confirmation email)
- [ ] Confirm email (click link in email)
- [ ] Verify profile created automatically
- [ ] Test login
- [ ] Test subscription activation
- [ ] Test campaign creation

---

## ✅ What Gets Preserved

### ✅ Preserved (NOT deleted):
- `auth.users` - All user accounts
- Email confirmation status
- User passwords
- User sessions

### ❌ Deleted (if you run reset):
- All campaigns
- All ad accounts
- All metrics history
- All insights
- Subscription data (profiles reset)

---

## 🔐 Email Confirmation Setup

### In Supabase Dashboard:

1. **Authentication** → **Settings**
   - ✅ **Enable email confirmations**
   - ✅ **Confirm email** = Required

2. **Authentication** → **Email Templates**
   - Edit "Confirm signup" template
   - Customize confirmation email

3. **Verify Settings:**
   ```sql
   -- Check auth configuration (read-only)
   SELECT 
    id,
    email,
    email_confirmed_at,
    created_at
   FROM auth.users
   ORDER BY created_at DESC;
   ```

### In Your Code:

Your code already handles email confirmation correctly:
- Production: Uses `supabaseClient.auth.signUp()` → sends confirmation email
- Development: Uses `supabaseAdmin.auth.admin.createUser()` with `email_confirm: true`

**No code changes needed!** ✅

---

## 🚀 After Setup

### Users Can:

1. **Sign Up**
   ```
   POST /auth/signup
   → Email confirmation sent
   ```

2. **Confirm Email**
   ```
   Click link in email
   → Profile created automatically (if trigger installed)
   → Can now log in
   ```

3. **Log In**
   ```
   POST /auth/login
   → Get JWT token
   → Use token for API calls
   ```

4. **Activate Subscription**
   ```
   POST /subscription/activate-dummy
   → Creates Plai account
   → Sets subscription to active
   ```

5. **Connect Ad Accounts**
   ```
   POST /subscription/sync-accounts
   → Fetches connected accounts from Plai
   → Stores in database
   ```

6. **Create Campaign**
   ```
   POST /campaigns
   → Creates campaign with realistic Meta parameters
   → Stores RAW data + calculated metrics
   ```

---

## 📝 Migration Order

If you already have some tables, run in this order:

1. **Reset (optional):**
   ```sql
   database/reset/001_reset_all_data.sql
   ```

2. **Complete Schema:**
   ```sql
   database/schema/000_complete_schema.sql
   ```

3. **Email Trigger (recommended):**
   ```sql
   database/schema/001_email_confirmation_trigger.sql
   ```

All scripts use `IF NOT EXISTS` so they're safe to run multiple times.

---

## ✅ Verification Queries

### Check Tables:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'profiles', 'ad_accounts', 'campaigns',
    'campaign_images', 'campaign_metrics_history', 
    'campaign_insights'
  )
ORDER BY table_name;
```

### Check Triggers:
```sql
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE '%email%';
```

### Check RLS Policies:
```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

---

**Ready to go! Run the setup scripts and you're all set! 🚀**

