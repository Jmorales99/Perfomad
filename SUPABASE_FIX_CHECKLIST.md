# ✅ Supabase Auth Fix Checklist

## The Issue
"Database error finding user" - User creation works in Dashboard but fails via API.

## Quick Checks

### 1. Check Email Confirmation Settings
In Supabase Dashboard → Authentication → Settings:

**Option A: Disable Email Confirmation (Dev)**
- Go to "Email confirmations"
- Toggle OFF "Enable email confirmations"
- Save

**Option B: Auto-Confirm (Dev)**
- Keep email confirmations ON
- But in your `.env` add:
  ```
  SUPABASE_AUTO_CONFIRM=true
  ```

### 2. Verify API Keys
In Supabase Dashboard → Settings → API:

- **Publishable key** → Should be in `.env` as `SUPABASE_PUBLISHABLE_KEY`
- **Secret key** → Should be in `.env` as `SUPABASE_SECRET_KEY`

**Important:** Make sure these are the **exact** keys from the Dashboard, not old keys.

### 3. Test with New Email
Try creating a user with a **completely new email** (not one that exists):
- Use: `test-${Date.now()}@example.com`
- If this works, the issue was duplicate email
- If this fails, it's a configuration issue

### 4. Check Supabase Logs
Go to Dashboard → Logs → Postgres Logs:
- Look for errors when you try to create user
- Share any database errors you see

## Most Likely Fix

**Disable email confirmation in dev mode:**
1. Dashboard → Authentication → Settings
2. Toggle OFF "Enable email confirmations"
3. Save
4. Try creating user again

This is the most common fix for "Database error finding user"!

