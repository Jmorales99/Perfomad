# 📋 Step-by-Step Database Setup

## 🎯 Your Situation

✅ You're okay with resetting everything  
✅ You want to maintain email confirmation  
✅ You don't have important data to preserve  

---

## 🚀 Complete Setup (Recommended)

### Step 1: Check What Data Exists (Optional)

```sql
-- Run this first to see what you have
-- File: database/reset/002_safe_reset_check.sql
```

This shows you what will be deleted. Review it, then proceed.

---

### Step 2: Reset Everything (Complete Fresh Start) ⭐

```sql
-- Run this to delete EVERYTHING including users
-- File: database/reset/003_complete_reset_delete_users.sql
```

**What happens:**
- ✅ All campaigns deleted
- ✅ All ad accounts deleted  
- ✅ All metrics history deleted
- ✅ All insights deleted
- ✅ All profiles deleted
- ✅ **All users deleted** (complete fresh start)
- ✅ Ready for new signups

**Alternative (Keep Users):**
If you want to keep existing users, use:
```sql
-- File: database/reset/001_reset_all_data.sql
-- (Keeps auth.users, only deletes application data)
```

---

### Step 3: Run Complete Schema

```sql
-- Run this to ensure all tables exist with correct structure
-- File: database/schema/000_complete_schema.sql
```

**What happens:**
- ✅ Creates all 6 tables (if not exist)
- ✅ Creates all indexes
- ✅ Sets up RLS policies
- ✅ Safe to run multiple times (uses IF NOT EXISTS)

---

### Step 4: Setup Email Confirmation Trigger (Recommended)

```sql
-- Run this to auto-create profiles when email is confirmed
-- File: database/schema/001_email_confirmation_trigger.sql
```

**What happens:**
- ✅ Creates trigger function
- ✅ Auto-creates profile when email confirmed
- ✅ Ensures email confirmation is required

---

### Step 5: Verify Supabase Auth Settings

**In Supabase Dashboard:**

1. Go to **Authentication** → **Settings**
2. Under **Email Auth**:
   - ✅ **Enable email confirmations** = ON
   - ✅ **Confirm email** = Required
3. Click **Save**

**Done!** Email confirmation is now required for all new signups.

---

## ✅ Verify Setup

### Check Tables Created:
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

**Expected:** 6 tables

### Check Email Confirmation Trigger:
```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE '%email%';
```

**Expected:** 2 triggers (`on_auth_user_created`, `on_auth_user_email_confirmed`)

### Check Existing Users (if any):
```sql
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as confirmed,
  created_at
FROM auth.users
ORDER BY created_at DESC;
```

---

## 🔄 What Happens to Existing Users

After running the reset script:

### Existing Users from `auth.users`:

| Status | What Happens | Action Needed |
|--------|--------------|---------------|
| **Email Confirmed** | ✅ Can log in immediately | Must reactivate subscription |
| **Email NOT Confirmed** | ⚠️ Cannot log in | Must confirm email first |
| **Password** | ✅ Unchanged | Can log in with same password |
| **Subscription** | ❌ Cleared | Reactivate via `/subscription/activate-dummy` |
| **Ad Accounts** | ❌ Deleted | Reconnect via `/subscription/sync-accounts` |
| **Campaigns** | ❌ Deleted | Create new campaigns |

### Example Flow for Existing User:

```
1. User tries to log in
   ↓
2. ✅ Success (email already confirmed)
   ↓
3. User sees empty dashboard (no campaigns)
   ↓
4. User activates subscription
   POST /subscription/activate-dummy
   ↓
5. User connects ad accounts
   POST /subscription/sync-accounts
   ↓
6. User creates new campaigns
   POST /campaigns
   ↓
7. Ready to use! ✅
```

---

## 🆕 What Happens to New Users

### New User Signup Flow:

```
1. User signs up
   POST /auth/signup
   ↓
2. Supabase sends confirmation email
   (Configured in Dashboard)
   ↓
3. User clicks confirmation link
   Email confirmed in auth.users
   ↓
4. Trigger automatically creates profile
   (If you installed the trigger)
   ↓
5. User can now log in
   POST /auth/login
   ↓
6. User activates subscription
   POST /subscription/activate-dummy
   ↓
7. User connects ad accounts
   POST /subscription/sync-accounts
   ↓
8. User creates campaigns
   POST /campaigns
```

---

## 📝 Complete Setup Checklist

### Database:
- [ ] Run `database/reset/002_safe_reset_check.sql` (optional - see what exists)
- [ ] Run `database/reset/001_reset_all_data.sql` (reset application data)
- [ ] Run `database/schema/000_complete_schema.sql` (create/update tables)
- [ ] Run `database/schema/001_email_confirmation_trigger.sql` (recommended)
- [ ] Verify all 6 tables created
- [ ] Verify triggers installed

### Supabase Auth:
- [ ] Go to Authentication → Settings
- [ ] Enable email confirmations = ON
- [ ] Set Confirm email = Required
- [ ] Save settings

### Testing:
- [ ] Test existing user login (should work)
- [ ] Test new user signup (should send email)
- [ ] Test email confirmation (click link)
- [ ] Verify profile created automatically
- [ ] Test subscription activation
- [ ] Test campaign creation with new parameters

---

## 🎯 Quick Commands

### If You Want Complete Fresh Start:

```sql
-- 1. See what exists
-- Run: database/reset/002_safe_reset_check.sql

-- 2. Reset application data
-- Run: database/reset/001_reset_all_data.sql

-- 3. Ensure schema is correct
-- Run: database/schema/000_complete_schema.sql

-- 4. Setup email confirmation trigger
-- Run: database/schema/001_email_confirmation_trigger.sql
```

### If You Only Want to Update Schema:

```sql
-- Just run the schema (safe, uses IF NOT EXISTS)
-- Run: database/schema/000_complete_schema.sql
```

---

## ✅ Summary

**Email Confirmation:**
- ✅ Preserved (handled by Supabase Auth)
- ✅ Required for new signups
- ✅ Existing users can still log in

**Data Reset:**
- ✅ All application data deleted
- ✅ Users preserved (can still log in)
- ✅ Fresh start for campaigns/accounts

**Ready to Use:**
- ✅ Complete schema
- ✅ Realistic campaign creation
- ✅ RAW data storage
- ✅ Historical metrics

---

**Run the scripts in order and you're all set! 🚀**

