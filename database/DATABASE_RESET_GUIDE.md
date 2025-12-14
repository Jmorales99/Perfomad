# 🔄 Database Reset Guide

## ⚠️ Important: Email Confirmation

**Email confirmation is handled by Supabase Auth**, not by your application tables.

- `auth.users` table (Supabase Auth) = Email confirmation happens here
- `profiles` table (your app) = Created AFTER email is confirmed

**Your code already handles this correctly!** The reset script preserves email confirmation.

---

## 🎯 Three Reset Options

### Option 1: Complete Reset - Delete Everything Including Users ⭐ (For Fresh Start)

**What it does:**
- ❌ Deletes `auth.users` (all users deleted)
- ❌ Deletes all campaigns, ad accounts, metrics
- ✅ Complete fresh start

**When to use:**
- Starting completely fresh
- Want to test from scratch
- No existing users to preserve

**Run:**
```sql
-- Execute in Supabase SQL Editor
database/reset/003_complete_reset_delete_users.sql
```

**Result:**
- All users deleted
- All data deleted
- Complete fresh start
- New users can sign up fresh

---

### Option 2: Reset Application Data Only (Keep Users)

**What it does:**
- ✅ Keeps `auth.users` (users can still log in)
- ✅ Keeps email confirmation status
- ✅ Deletes all campaigns, ad accounts, metrics
- ✅ Resets profiles (subscription data cleared)

**When to use:**
- You want to keep existing users
- Users need to reactivate subscription
- Clean slate for testing

**Run:**
```sql
-- Execute in Supabase SQL Editor
database/reset/001_reset_all_data.sql
```

**Result:**
- Users can still log in (email already confirmed)
- All campaigns/ad accounts deleted
- Users must reactivate subscription
- Users must reconnect ad accounts

---

### Option 3: Complete Fresh Start (Alternative Method)

**What it does:**
- ❌ Deletes ALL data including auth.users
- ❌ All users deleted
- ✅ Complete fresh start

**When to use:**
- Starting completely fresh
- No existing users to preserve
- Testing from scratch

**Steps:**
1. **Delete all application data:**
   ```sql
   -- Run: database/reset/001_reset_all_data.sql
   ```

2. **Delete auth users (via Supabase Dashboard):**
   - Go to **Authentication** → **Users**
   - Select all users
   - Click **Delete**
   
   OR via SQL (careful!):
   ```sql
   -- WARNING: This deletes ALL users!
   -- Only use if you want complete reset
   DELETE FROM auth.users;
   ```

3. **Run complete schema:**
   ```sql
   -- Run: database/schema/000_complete_schema.sql
   ```

---

## 📋 Recommended Reset Process

### Step 1: Run Reset Script

1. Open Supabase SQL Editor
2. Open: `database/reset/001_reset_all_data.sql`
3. Copy and paste into SQL Editor
4. Click **Run**

**What happens:**
- All campaigns deleted
- All ad accounts deleted
- All metrics history deleted
- All insights deleted
- Profiles reset (subscription data cleared)
- **auth.users preserved** (users can still log in)

### Step 2: Verify Reset

```sql
-- Check everything is cleared
SELECT 
  (SELECT COUNT(*) FROM campaigns) as campaigns,
  (SELECT COUNT(*) FROM ad_accounts) as ad_accounts,
  (SELECT COUNT(*) FROM campaign_metrics_history) as metrics_history,
  (SELECT COUNT(*) FROM campaign_insights) as insights,
  (SELECT COUNT(*) FROM profiles) as profiles,
  (SELECT COUNT(*) FROM auth.users) as auth_users;
```

**Expected:**
- campaigns: 0
- ad_accounts: 0
- metrics_history: 0
- insights: 0
- profiles: same as auth_users (profiles kept)
- auth_users: same as before (users preserved)

### Step 3: Setup Email Confirmation Trigger (Optional)

If you want automatic profile creation when email is confirmed:

```sql
-- Run: database/schema/001_email_confirmation_trigger.sql
```

**What it does:**
- Automatically creates profile when email is confirmed
- Ensures email confirmation is required
- Works in production automatically

---

## 🔐 Email Confirmation Settings

### Configure in Supabase Dashboard:

1. Go to **Authentication** → **Settings**
2. Under **Email Auth**:
   - ✅ **Enable email confirmations** (make sure this is ON)
   - ✅ **Confirm email** = Required
   - Set **Email template** for confirmation

3. Under **Email Templates**:
   - Configure "Confirm signup" email template
   - Users will receive confirmation link

### Verify Email Confirmation Status:

```sql
-- Check which users have confirmed emails
SELECT 
  id,
  email,
  email_confirmed_at,
  created_at
FROM auth.users
ORDER BY created_at DESC;
```

**Email confirmed if:** `email_confirmed_at IS NOT NULL`

---

## 📝 What Happens After Reset

### Existing Users (from auth.users):

1. **Can still log in** ✅
   - Email already confirmed
   - Password unchanged
   - Session tokens work

2. **Must reactivate subscription** ⚠️
   - Subscription data cleared
   - Call: `POST /subscription/activate-dummy`

3. **Must reconnect ad accounts** ⚠️
   - Ad accounts deleted
   - Call: `POST /subscription/sync-accounts`

4. **All campaigns deleted** ⚠️
   - Must create new campaigns

### New Users:

1. **Sign up** → Email sent for confirmation
2. **Click confirmation link** → Email confirmed
3. **Profile created automatically** (if trigger installed)
4. **Can log in and use app**

---

## 🔄 Complete Reset Flow

### Scenario: You want fresh start but keep users

```
1. Run: database/reset/001_reset_all_data.sql
   ↓
2. Users can still log in (email confirmed)
   ↓
3. Users reactivate subscription
   ↓
4. Users reconnect ad accounts
   ↓
5. Users create new campaigns
   ↓
6. Fresh start with existing users! ✅
```

### Scenario: Complete fresh start

```
1. Run: database/reset/001_reset_all_data.sql
   ↓
2. Delete all users from Supabase Dashboard
   ↓
3. (Optional) Run: database/schema/000_complete_schema.sql
   ↓
4. Complete fresh start! ✅
```

---

## ✅ Reset Checklist

### Before Reset:
- [ ] Backup any important data (if needed)
- [ ] Document any test users you want to keep
- [ ] Note down any important campaign IDs (if needed)

### During Reset:
- [ ] Run `001_reset_all_data.sql`
- [ ] Verify reset completed successfully
- [ ] (Optional) Install email confirmation trigger

### After Reset:
- [ ] Test user login (should still work)
- [ ] Test user signup → email confirmation
- [ ] Test subscription activation
- [ ] Test ad account connection
- [ ] Test campaign creation

---

## 🐛 Troubleshooting

### Error: "foreign key constraint"

**Solution**: The reset script handles this by deleting in correct order. If you get this error:

```sql
-- Manually delete in this order:
DELETE FROM campaign_insights;
DELETE FROM campaign_metrics_history;
DELETE FROM campaign_images;
DELETE FROM campaigns;
DELETE FROM ad_accounts;
UPDATE profiles SET has_active_subscription = false, plai_user_id = NULL;
```

### Users can't log in after reset

**Solution**: 
- Check `auth.users` table still has users
- Check `email_confirmed_at` is not NULL
- Reset password if needed

### Profile not created after email confirmation

**Solution**:
- Install email confirmation trigger: `001_email_confirmation_trigger.sql`
- Or manually create profile after confirmation

---

## 📚 Related Files

- `database/schema/000_complete_schema.sql` - Complete schema
- `database/reset/001_reset_all_data.sql` - Reset script
- `database/schema/001_email_confirmation_trigger.sql` - Email confirmation trigger
- `database/DATABASE_SETUP_GUIDE.md` - Initial setup guide

---

## ✅ Summary

**Email confirmation is preserved** because:
1. `auth.users` table is NOT deleted (Supabase Auth handles this)
2. Email confirmation status stays in `auth.users.email_confirmed_at`
3. Reset only clears application data (campaigns, accounts, etc.)

**After reset:**
- ✅ Users can log in (email already confirmed)
- ✅ Email confirmation requirement maintained
- ✅ Fresh application data
- ⚠️ Users must reactivate subscription and reconnect accounts

---

**Ready to reset? Run `001_reset_all_data.sql`! 🚀**

