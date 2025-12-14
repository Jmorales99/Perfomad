# 🔗 How to Connect Ad Accounts

## Overview

Before creating campaigns, users must:
1. ✅ Have an active subscription
2. ✅ Connect their advertising accounts (Meta, Google Ads, or LinkedIn)

## Step-by-Step Process

### Step 1: Activate Subscription

**Endpoint:** `POST /v1/subscription/activate`

**Request:**
```json
{
  // No body needed - uses authenticated user
}
```

**Response:**
```json
{
  "message": "Suscripción activada correctamente ✅",
  "plai_user_id": "user_123456",
  "subscription_start": "2024-01-15T10:00:00Z",
  "expires_at": "2024-02-15T10:00:00Z"
}
```

**What happens:**
- Creates or links Plai account
- Activates subscription in database
- User can now connect ad accounts

---

### Step 2: Get Connection Link

**Endpoint:** `POST /v1/subscription/connect-account`

**Request:**
```json
{
  "platform": "meta",
  "redirect_uri": "https://yourapp.com/callback",
  "state": "optional-state-data"
}
```

**Supported platforms:**
- `"meta"` - Meta (Facebook/Instagram)
- `"google_ads"` - Google Ads
- `"linkedin"` - LinkedIn Ads

**Response:**
```json
{
  "link": "https://connect.plai.io/meta?uid=user_123456&redirect=...",
  "platform": "meta"
}
```

**What to do:**
1. Redirect user to the `link` URL
2. User authorizes your app in the platform (Meta/Google/LinkedIn)
3. User is redirected back to your `redirect_uri`

---

### Step 3: Sync Connected Accounts

After user authorizes, sync the accounts:

**Endpoint:** `POST /v1/subscription/sync-accounts`

**Request:**
```json
{
  // No body needed - uses authenticated user
}
```

**Response:**
```json
{
  "message": "Cuentas sincronizadas correctamente",
  "accounts": [
    {
      "id": "uuid",
      "platform": "meta",
      "platform_account_id": "act_123456",
      "account_name": "My Meta Account",
      "is_active": true
    }
  ],
  "count": 1
}
```

**What happens:**
- Fetches connected accounts from Plai API
- Stores them in your `ad_accounts` table
- Now user can create campaigns!

---

## Check Account Status

**Endpoint:** `GET /v1/subscription/accounts`

**Response:**
```json
{
  "accounts": [
    {
      "id": "uuid",
      "platform": "meta",
      "platform_account_id": "act_123456",
      "account_name": "My Meta Account",
      "is_active": true,
      "connected_at": "2024-01-15T10:00:00Z"
    }
  ],
  "count": 1
}
```

**Use this to:**
- Show user which accounts are connected
- Check if user needs to connect more accounts
- Display account status in UI

---

## Check if User Can Create Campaigns

**Endpoint:** `GET /v1/campaigns/can-create`

**Response:**
```json
{
  "can_create": false,
  "has_subscription": true,
  "has_plai_account": true,
  "ad_accounts_count": 0,
  "ad_accounts": [],
  "missing_requirements": [
    "Cuentas de publicidad conectadas"
  ],
  "message": "No puedes crear campañas. Verifica tus suscripción y cuentas de publicidad."
}
```

**Use this to:**
- Check if user can create campaigns before showing "Create Campaign" button
- Display helpful messages about what's missing
- Guide user through setup process

---

## Complete Flow Example

```javascript
// 1. Check if user can create campaigns
const status = await fetch('/v1/campaigns/can-create')
const { can_create, missing_requirements } = await status.json()

if (!can_create) {
  // Show message: "Connect ad accounts to create campaigns"
  // Show button: "Connect Accounts"
}

// 2. User clicks "Connect Accounts" → Get connection link
const response = await fetch('/v1/subscription/connect-account', {
  method: 'POST',
  body: JSON.stringify({ platform: 'meta' })
})
const { link } = await response.json()

// 3. Redirect user to link
window.location.href = link

// 4. After user authorizes → User redirected back → Sync accounts
await fetch('/v1/subscription/sync-accounts', { method: 'POST' })

// 5. Now user can create campaigns!
```

---

## Error Messages

### When Creating Campaign Without Accounts

**Error Response:**
```json
{
  "error": "Cuentas de publicidad no conectadas",
  "message": "⚠️ No puedes crear campañas sin cuentas de publicidad conectadas.",
  "details": "Debes conectar tus cuentas de publicidad para: Meta (Facebook/Instagram)",
  "missing_platforms": ["meta"],
  "action_required": "Conecta tus cuentas de publicidad antes de crear campañas",
  "help_url": "/subscription/accounts"
}
```

**Frontend should:**
- Display clear error message
- Show button/link to connect accounts
- Redirect to accounts page

---

## ✅ Quick Checklist for Users

- [ ] Activate subscription (`POST /subscription/activate`)
- [ ] Connect ad account (`POST /subscription/connect-account` + redirect)
- [ ] Sync accounts (`POST /subscription/sync-accounts`)
- [ ] Verify accounts (`GET /subscription/accounts`)
- [ ] Create campaign! (`POST /campaigns`)

