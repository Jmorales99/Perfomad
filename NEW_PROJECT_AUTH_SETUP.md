# 🔐 New Supabase Project - Auth Configuration

## Step-by-Step Authentication Setup

### 1. Email Settings (Important!)

Go to: **Authentication** → **Settings** (or look for email-related settings)

**Find:**
- "Email confirmations" or "Enable email confirmations"
- **Toggle it OFF** (for development)

**Why?** This prevents the "Database error finding user" issue when users sign up.

### 2. Sign In / Providers

You're already here! ✅

**Configure:**
- **Email** provider should be enabled by default ✅
- Leave other providers (Google, GitHub, etc.) disabled for now (unless you need them)

### 3. URL Configuration

Go to: **Authentication** → **URL Configuration**

**Set:**
- **Site URL**: `http://localhost:5173` (or your frontend URL)
- **Redirect URLs**: Add `http://localhost:5173/**` (allows redirects after auth)

### 4. Policies (Optional for now)

Go to: **Authentication** → **Policies**

- Default policies should be fine for now
- You can configure RLS later if needed

## ✅ Quick Checklist

- [ ] Email confirmations: **OFF** (dev mode)
- [ ] Email provider: **ENABLED**
- [ ] Site URL: Set to your frontend URL
- [ ] Redirect URLs: Configured

## 🚀 Next Steps

After configuring Auth:
1. Go to **SQL Editor**
2. Run: `database/schema/000_complete_schema.sql`
3. Update your `.env` with new API keys
4. Restart server
5. Test user creation!

---

**Most Important:** Disable email confirmations for development! ✅

