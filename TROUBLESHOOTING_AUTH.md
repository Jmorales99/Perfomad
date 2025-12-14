# 🔧 Troubleshooting "Database error checking email"

## Current Situation
- ✅ All triggers removed
- ✅ All tables exist
- ❌ Still getting "Database error checking email"

## Possible Causes

### 1. Supabase Service Role Key Issue

Check your `.env` file:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Verify:**
- Go to Supabase Dashboard → Settings → API
- Copy the **Service Role Key** (not the anon key)
- Make sure it's in your `.env` file
- Restart your server after changing `.env`

### 2. Supabase Project Status

Check if your Supabase project is:
- ✅ Active (not paused)
- ✅ Database is accessible
- ✅ Auth is enabled

Go to: Supabase Dashboard → Project Settings → General

### 3. Check Supabase Logs

1. Go to Supabase Dashboard → Logs → Postgres Logs
2. Try creating a user
3. Look for errors in the logs
4. Share the error message

### 4. Test Creating User Directly in Dashboard

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add user"
3. Try creating a user manually
4. If this fails, it's a Supabase-side issue, not your code

### 5. Test Database Connection

Run this SQL in Supabase SQL Editor:
```sql
-- File: database/troubleshooting/005_test_auth_directly.sql
```

This tests if you can query `auth.users` directly.

### 6. Try Using Regular Client Instead of Admin

The code currently uses `supabaseAdmin.auth.admin.createUser()` in dev mode. 

**Temporary test:** Try changing dev mode to use regular client instead:

```typescript
// In SupabaseUserRepository.ts, temporarily change:
// FROM: supabaseAdmin.auth.admin.createUser
// TO: supabaseClient.auth.signUp
```

This will tell us if the issue is with admin client permissions.

## 🔍 Debug Steps

1. **Check `.env` file** - Service role key correct?
2. **Restart server** - After changing `.env`
3. **Check Supabase Dashboard** - Project status, Auth enabled?
4. **Check Supabase Logs** - Any database errors?
5. **Test in Dashboard** - Can you create user manually?

## ⚠️ Important Notes

The error "Database error checking email" happens **inside Supabase Auth** before your code runs. This suggests:
- Database connection issue
- Permission issue with service role
- Supabase project configuration issue
- Not a code issue (since triggers are removed)

