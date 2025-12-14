# 🔗 Account Connection Flow

## Overview

The application supports **two different connection flows** depending on the environment:

1. **Development**: Uses mock API with credentials modal
2. **Production**: Uses real Plai API with OAuth redirect

---

## 🔄 Development Flow (Current)

### How It Works

1. User clicks "Conectar" on a platform (Meta, Google Ads, LinkedIn)
2. **Modal appears** asking for email/password credentials
3. User enters credentials (any credentials work - it's a simulation)
4. Backend sends credentials to **mock API** (`http://localhost:4001`)
5. Mock API "connects" the account and stores it in memory
6. Backend syncs accounts from mock API to your database
7. Account appears as "Conectado" in Settings

### Why This Exists

- Allows development/testing without real platform accounts
- No need to set up OAuth credentials
- Fast iteration during development

---

## 🚀 Production Flow (Real Plai API)

### How It Works

1. User clicks "Conectar" on a platform
2. Backend requests **OAuth link** from Plai API
3. User is **redirected** to platform's OAuth page (Meta/Google/LinkedIn)
4. User **authorizes** your app on the platform
5. Platform redirects back with authorization code
6. Plai API exchanges code for access token
7. Backend **syncs accounts** from Plai API
8. Account appears as "Conectado" in Settings

### Why OAuth?

- **Secure**: No credentials stored or transmitted
- **Standard**: Industry standard for platform integrations
- **User-friendly**: Users authorize directly on platform website
- **Revocable**: Users can disconnect anytime from platform settings

---

## 🔧 Configuration

### Development Setup

```env
# .env (development)
MOCK_API_URL=http://localhost:4001
MOCK_API_KEY=mock-key

# Frontend shows credentials modal
```

### Production Setup

```env
# .env (production)
PLAI_API_URL=https://api.plai.io
PLAI_API_KEY=your-production-api-key

# Frontend uses OAuth redirect
```

### How Code Detects Which Flow to Use

**Backend:**
```typescript
// src/infrastructure/services/PlaiApiClient.ts
const apiUrl = process.env.PLAI_API_URL || process.env.MOCK_API_URL || "http://localhost:4001"
```

**Frontend:**
```typescript
// Detects production mode
const isProduction = import.meta.env.PROD || import.meta.env.VITE_PLAI_API_URL
```

---

## 📱 User Experience

### Development (Credentials Modal)

```
User clicks "Conectar" 
  → Modal opens
  → User enters email/password
  → Clicks "Conectar"
  → Account connected ✅
  → Redirects to Settings
```

### Production (OAuth Redirect)

```
User clicks "Conectar"
  → Redirected to Meta/Google/LinkedIn
  → User sees: "App wants to access your account"
  → User clicks "Authorize"
  → Redirected back to Settings
  → Account connected ✅
```

---

## 🔐 Security Considerations

### Development (Mock)

- ✅ Safe for local development
- ⚠️ Credentials are not validated (simulated)
- ⚠️ Not secure - don't use in production

### Production (OAuth)

- ✅ Secure - no credentials stored
- ✅ Industry standard
- ✅ Users control access via platform settings
- ✅ Tokens managed by Plai API (not your app)

---

## 🛠️ Implementation Details

### Backend Endpoints

1. **Get OAuth Link**
   ```
   POST /v1/subscription/connect-account
   {
     "platform": "meta",
     "redirect_uri": "https://yourapp.com/settings"
   }
   ```
   Returns: `{ link: "https://..." }`

2. **Sync Connected Accounts**
   ```
   POST /v1/subscription/sync-accounts
   ```
   Fetches connected accounts from Plai and stores in database

3. **List Accounts**
   ```
   GET /v1/subscription/accounts
   ```
   Returns user's connected accounts from your database

### Frontend Components

1. **Settings Page**: Shows connected accounts and "Conectar" buttons
2. **ConnectAccountModal**: Credentials modal (dev only)
3. **OAuth Redirect**: Automatic redirect flow (production)

---

## ✅ Testing

### Test Development Flow

1. Make sure mock API is running: `cd plai-mock-api && npm run dev`
2. Set environment: `MOCK_API_URL=http://localhost:4001`
3. Click "Conectar" → Modal appears
4. Enter any credentials → Account connects

### Test Production Flow

1. Get Plai API credentials
2. Set environment: `PLAI_API_URL=https://api.plai.io`
3. Click "Conectar" → Redirects to platform
4. Authorize → Account connects

---

## 📚 References

- [Plai API Docs](https://docs.plai.io/introduction)
- OAuth 2.0 standard for Meta, Google, LinkedIn

---

## ❓ FAQ

**Q: Will accounts connected in dev work in production?**
A: No, mock API accounts are only for development. Users need to connect via OAuth in production.

**Q: Can I test production flow locally?**
A: Yes, just set `PLAI_API_URL` and `PLAI_API_KEY` environment variables.

**Q: What if user doesn't authorize on platform?**
A: They'll be redirected back to your app without connecting. You can show a message.

**Q: Can users disconnect accounts?**
A: Yes, either from your app (if you implement disconnect) or from platform settings.

