# 🚀 Quick Start - Complete Fresh Setup

## ⚡ Fastest Way to Get Started (Complete Reset)

Since you want to delete everything and start fresh:

### Step 1: Complete Reset (Delete Everything)

```sql
-- Run in Supabase SQL Editor
-- File: database/reset/003_complete_reset_delete_users.sql
```

**This deletes:**
- ✅ All users
- ✅ All campaigns
- ✅ All ad accounts
- ✅ All metrics
- ✅ Everything!

---

### Step 2: Create Complete Schema

```sql
-- Run in Supabase SQL Editor
-- File: database/schema/000_complete_schema.sql
```

**This creates:**
- ✅ All 6 tables
- ✅ All indexes
- ✅ RLS policies

---

### Step 3: Setup Email Confirmation Trigger

```sql
-- Run in Supabase SQL Editor
-- File: database/schema/001_email_confirmation_trigger.sql
```

**This sets up:**
- ✅ Auto profile creation on email confirmation
- ✅ Email confirmation requirement

---

### Step 4: Configure Supabase Auth

**In Supabase Dashboard:**
1. Go to **Authentication** → **Settings**
2. Enable **Email confirmations** = ON
3. Set **Confirm email** = Required
4. Save

---

## ✅ You're Done!

Now you have:
- ✅ Empty database (fresh start)
- ✅ All tables created
- ✅ Email confirmation required
- ✅ Ready for new users

### Test It:

1. **Sign up new user:**
   ```bash
   POST /auth/signup
   {
     "email": "test@example.com",
     "password": "password123",
     "name": "Test User",
     "age": 25,
     "phone": "+1234567890"
   }
   ```

2. **Check email** - User receives confirmation email

3. **Confirm email** - Click link in email

4. **Profile created automatically** ✅

5. **Login:**
   ```bash
   POST /auth/login
   {
     "email": "test@example.com",
     "password": "password123"
   }
   ```

---

**Everything is ready for fresh start! 🎉**

