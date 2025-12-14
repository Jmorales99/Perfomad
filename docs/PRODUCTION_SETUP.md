# 🚀 Production Setup Guide

## Overview

When moving to production, your application will use the **real Plai API** instead of the mock API. The connection flow changes from credentials-based to **OAuth-based** (the standard way platforms like Meta, Google, and LinkedIn handle authorization).

---

## 🔄 Connection Flow Comparison

### Development (Current - Mock API)
1. User clicks "Conectar"
2. Modal appears asking for email/password
3. Backend sends credentials to mock API
4. Account is "connected" (simulated)
5. Account stored in database

### Production (Real Plai API)
1. User clicks "Conectar"
2. Backend requests OAuth link from Plai API
3. User is **redirected to platform** (Meta/Google/LinkedIn)
4. User authorizes your app on the platform
5. Platform redirects back with authorization code
6. Plai API exchanges code for access token
7. Account is connected and stored in your database

---

## 📋 Production Configuration

### 1. Environment Variables

Add these to your production `.env`:

```env
# Production Plai API
PLAI_API_URL=https://api.plai.io
PLAI_API_KEY=your-production-plai-api-key

# Remove or comment out mock API variables:
# MOCK_API_URL=http://localhost:4001
# MOCK_API_KEY=mock-key
```

### 2. Frontend Updates

The frontend **already supports both flows**:

- **Development**: Shows credentials modal (current behavior)
- **Production**: Uses OAuth redirect flow (automatic)

You may want to update the Settings page to detect which mode you're in:

```typescript
// In SettingsPage.tsx - optional enhancement
const isDevelopment = !import.meta.env.VITE_PLAI_API_URL
const useOAuthFlow = !isDevelopment

if (useOAuthFlow) {
  // Use OAuth flow (redirect)
  const { link } = await createConnectionLink(platform, redirectUri)
  window.location.href = link
} else {
  // Use credentials modal (development only)
  setConnectingPlatform(platform)
}
```

---

## 🔐 How OAuth Works in Production

### Step-by-Step Flow

1. **User clicks "Conectar"** (e.g., Meta Ads)
   ```typescript
   POST /v1/subscription/connect-account
   {
     "platform": "meta",
     "redirect_uri": "https://yourapp.com/settings"
   }
   ```

2. **Backend calls Plai API**
   ```typescript
   POST https://api.plai.io/auth/create_link
   {
     "userId": "user_123",
     "platform": "meta",
     "redirectUri": "https://yourapp.com/settings"
   }
   ```

3. **Plai returns OAuth URL**
   ```json
   {
     "results": {
       "link": "https://www.facebook.com/v18.0/dialog/oauth?..."
     }
   }
   ```

4. **Frontend redirects user** to that URL

5. **User authorizes** on Meta's website

6. **Meta redirects back** to your app:
   ```
   https://yourapp.com/settings?code=ABC123&state=xyz
   ```

7. **Your backend calls sync** (or Plai handles the callback):
   ```typescript
   POST /v1/subscription/sync-accounts
   ```

8. **Account appears** as connected

---

## 🔧 What You Need to Do

### 1. Get Plai API Credentials

Contact Plai to get:
- **API URL**: Usually `https://api.plai.io`
- **API Key**: Your production API key
- **OAuth Redirect URLs**: Whitelist your production domain

### 2. Update Environment Variables

In production, set:
```env
PLAI_API_URL=https://api.plai.io
PLAI_API_KEY=your-real-api-key
```

### 3. Configure Redirect URLs

In your Plai dashboard, add:
- `https://yourapp.com/settings`
- `https://yourapp.com/auth/callback` (if you create a callback page)

### 4. Update Frontend (Optional Enhancement)

You can update the Settings page to automatically use OAuth in production:

```typescript
// src/interface/pages/settings/SettingsPage.tsx

const handleConnect = async (platform: Platform) => {
  // Check if using production Plai API
  const isProduction = import.meta.env.PROD || import.meta.env.VITE_PLAI_API_URL
  
  if (isProduction) {
    // Production: Use OAuth redirect
    try {
      const redirectUri = `${window.location.origin}/settings`
      const { link } = await createConnectionLink(platform, redirectUri)
      window.location.href = link
    } catch (e) {
      console.error("Error creating connection link:", e)
      alert("Error al conectar cuenta")
    }
  } else {
    // Development: Show credentials modal
    setConnectingPlatform(platform)
  }
}
```

---

## ✅ Current Code Status

### Already Production-Ready ✅

1. **Backend**: 
   - ✅ `PlaiApiClient` checks for `PLAI_API_URL` first
   - ✅ Falls back to mock API if not set
   - ✅ All OAuth endpoints already implemented

2. **Database**:
   - ✅ Accounts stored in `ad_accounts` table
   - ✅ RLS policies configured correctly
   - ✅ Admin client used for backend operations

3. **API Endpoints**:
   - ✅ `POST /v1/subscription/connect-account` - Creates OAuth link
   - ✅ `POST /v1/subscription/sync-accounts` - Syncs connected accounts
   - ✅ `GET /v1/subscription/accounts` - Lists user's accounts

### What Changes in Production

1. **Connection Flow**: 
   - Development: Credentials modal → Mock API
   - Production: OAuth redirect → Real Plai API → Platform authorization

2. **API Calls**:
   - Development: Calls `http://localhost:4001`
   - Production: Calls `https://api.plai.io`

---

## 🧪 Testing Production Flow Locally

You can test the OAuth flow locally by:

1. Setting environment variables:
   ```env
   PLAI_API_URL=https://api.plai.io
   PLAI_API_KEY=your-test-key
   ```

2. The code will automatically use the real Plai API

3. You'll need valid redirect URLs configured in Plai dashboard

---

## 📚 References

- [Plai API Documentation](https://docs.plai.io/introduction)
- Plai supports OAuth for Meta, Google Ads, and LinkedIn (coming soon)

---

## 🔒 Security Notes

1. **Never store OAuth tokens** in your frontend
2. **Plai handles token management** - you just get connected accounts
3. **RLS policies** ensure users can only see their own accounts
4. **Backend validates** user authorization before all operations

---

## ❓ FAQ

**Q: Will users need to re-connect in production?**
A: Yes, accounts connected via mock API are only for development. Users will need to connect via OAuth in production.

**Q: Can I use both mock and real API?**
A: The code automatically uses `PLAI_API_URL` if set, otherwise falls back to mock. You can't use both simultaneously.

**Q: What happens if Plai API is down?**
A: Your app will fail gracefully with error messages. Consider implementing retry logic or caching.

**Q: Do I need to handle OAuth callback in my app?**
A: Typically Plai handles the OAuth flow, and you just sync accounts afterward. Check Plai docs for specifics.

