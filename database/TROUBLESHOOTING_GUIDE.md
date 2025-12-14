# 🔧 Troubleshooting "Database error checking email"

## Problem
When trying to create a user, you get:
```
AuthApiError: Database error checking email
```

## Root Cause
This error happens **inside Supabase Auth** before your code runs. Supabase Auth is trying to check if the email exists in the database, but something is interfering.

## ✅ Step-by-Step Fix

### Step 1: Remove ALL Triggers (CRITICAL)

Run this SQL in Supabase SQL Editor:

```sql
-- Remove all triggers on auth.users
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Remove trigger functions
DROP FUNCTION IF EXISTS public.handle_email_confirmation();
DROP FUNCTION IF EXISTS public.handle_new_user_confirmed();
DROP FUNCTION IF EXISTS public.handle_new_user();
```

**OR run:** `database/schema/002_remove_email_trigger.sql`

### Step 2: Verify Triggers Are Gone

Run this to check:
```sql
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'users'
AND event_object_schema = 'auth';
```

**Expected:** No rows returned (empty result)

### Step 3: Check Supabase Dashboard Settings

In Supabase Dashboard → Authentication → Settings:

1. **Email confirmations**: Should be ON (not the issue, but verify)
2. **Confirm email**: Required or Optional (either works)
3. **Database URL**: Verify it's correct in your `.env`

### Step 4: Check Database Connection

Verify your Supabase credentials are correct:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (used by `supabaseAdmin`)

### Step 5: Check Supabase Logs

1. Go to Supabase Dashboard → Logs → Postgres Logs
2. Look for errors around the time of signup
3. Share any database errors you see

### Step 6: Test with Simple Query

In Supabase SQL Editor, test if you can query auth.users:
```sql
SELECT COUNT(*) FROM auth.users;
```

If this fails, there's a permission issue.

## ✅ Expected Result After Fix

After removing triggers, user creation should work:
1. User created in `auth.users` ✅
2. Profile created in `profiles` ✅ (by your application code)
3. No errors ✅

## 📝 Current Flow (After Fix)

1. **User signs up** → `supabaseAdmin.auth.admin.createUser()` 
   - Creates user in `auth.users` (no triggers interfere)
   
2. **Your code** → `insertProfile()`
   - Creates profile in `profiles` table
   - Handles duplicates gracefully

## ⚠️ Common Mistakes

1. **Didn't run trigger removal SQL** - Most common cause!
2. **Trigger still exists** - Check with Step 2
3. **Wrong service role key** - Check `.env` file
4. **Database connection issues** - Check Supabase project status

## 🆘 Still Not Working?

If it still doesn't work after removing triggers:
1. Check Supabase project status (is it paused?)
2. Verify service role key is correct
3. Check Postgres logs in Supabase Dashboard
4. Try creating user directly in Supabase Dashboard (Authentication → Users → Add user)

