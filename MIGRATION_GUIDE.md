# Migration Guide: New Architecture Implementation

## 📋 Summary of Changes

This implementation refactors the application to properly manage client data and integrate with the Plai API. The flow is now:

1. **Client subscribes** → Creates/links Plai account automatically
2. **Client connects ad accounts** → Uses Plai API to connect Meta/Google/LinkedIn accounts
3. **Client creates campaigns** → Uses real connected accounts instead of hardcoded IDs
4. **Data sync** → Your database is the source of truth, synced with Plai

---

## 🗄️ Database Changes Required

You need to run these SQL migrations in your Supabase database:

### 1. Create `ad_accounts` table

Run: `database/migrations/001_create_ad_accounts_table.sql`

This creates the table to store connected advertising accounts.

### 2. Update `profiles` and `campaigns` tables

Run: `database/migrations/002_update_profiles_table.sql`

This:
- Adds `plai_user_id` column to `profiles` (copies from `plai_mock_user_id` if exists)
- Converts `campaigns.mock_campaign_id` to JSONB for multi-platform support
- Ensures `campaigns.mock_stats` is JSONB

**Note:** The migration handles existing data gracefully. If you have existing `plai_mock_user_id` values, they'll be copied to `plai_user_id`.

---

## 📁 New Files Created

### Infrastructure Services
- `src/infrastructure/services/PlaiApiClient.ts` - Wraps all Plai API calls

### Infrastructure Repositories
- `src/infrastructure/repositories/SupabaseAdAccountsRepository.ts` - Manages ad accounts in database

### Use Cases
- `src/application/usecases/subscriptions/ActivateSubscription.ts` - Activates subscription and creates Plai account
- `src/application/usecases/adaccounts/SyncConnectedAccounts.ts` - Syncs connected accounts from Plai
- `src/application/usecases/adaccounts/CreateConnectionLink.ts` - Creates OAuth connection links
- `src/application/usecases/campaigns/CreateCampaign.ts` - Creates campaigns using connected accounts
- `src/application/usecases/campaigns/SyncCampaignMetrics.ts` - Syncs campaign metrics from Plai

---

## 🔄 Updated Controllers

### SubscriptionController

**New endpoints:**
- `POST /v1/subscription/activate` - Activate subscription (replaces `/activate-dummy`)
- `POST /v1/subscription/connect-account` - Get OAuth link for connecting platform account
- `POST /v1/subscription/sync-accounts` - Sync connected accounts from Plai
- `GET /v1/subscription/accounts` - List user's connected accounts

**Legacy endpoint:**
- `POST /v1/subscription/activate-dummy` - Still works, redirects to new endpoint

### CampaignsController

**Updated endpoints:**
- `POST /v1/campaigns` - Now requires connected ad accounts, uses real accounts
- `GET /v1/campaigns/:id/overview` - Improved metrics handling
- `PATCH /v1/campaigns/:id` - Syncs status/budget updates to Plai
- `POST /v1/campaigns/:id/sync` - New endpoint to sync metrics from Plai

---

## 🔄 Complete User Flow

### 1. Client Subscribes

```bash
POST /v1/subscription/activate
Authorization: Bearer <token>
```

**What happens:**
- Creates or links Plai user profile
- Stores `plai_user_id` in `profiles` table
- Activates subscription in your database

**Response:**
```json
{
  "message": "Suscripción activada correctamente ✅",
  "plai_user_id": "user_123456",
  "subscription_start": "2024-01-15T10:00:00Z",
  "expires_at": "2024-02-15T10:00:00Z"
}
```

### 2. Client Connects Ad Accounts

**Step 1:** Get OAuth connection link
```bash
POST /v1/subscription/connect-account
Authorization: Bearer <token>
{
  "platform": "meta",
  "redirect_uri": "https://yourapp.com/callback",
  "state": "optional-state"
}
```

**Response:**
```json
{
  "link": "https://connect.mock.plai.io/meta?uid=user_123456&redirect=...",
  "platform": "meta"
}
```

**Step 2:** After user connects account in Plai, sync accounts
```bash
POST /v1/subscription/sync-accounts
Authorization: Bearer <token>
```

**What happens:**
- Fetches connected accounts from Plai API
- Stores them in `ad_accounts` table

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

### 3. Client Creates Campaign

```bash
POST /v1/campaigns
Authorization: Bearer <token>
{
  "name": "Summer Sale",
  "platforms": ["meta"],
  "budget_usd": 100,
  "description": "Summer campaign",
  "start_date": "2024-06-01T00:00:00Z",
  "end_date": "2024-06-30T23:59:59Z"
}
```

**What happens:**
- Validates user has connected accounts for selected platforms
- Creates campaign in your database
- Creates campaign in Plai using connected account
- Stores Plai campaign ID(s) as JSON: `{"meta": "camp_123"}`
- Stores initial metrics

**Response:** Campaign object with `mock_campaign_id` and `mock_stats`

### 4. Sync Campaign Metrics

```bash
POST /v1/campaigns/:id/sync
Authorization: Bearer <token>
```

**What happens:**
- Fetches latest metrics from Plai for all platforms
- Updates `spend_usd` and `mock_stats` in your database

---

## 📊 Data Structure

### `ad_accounts` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key to `auth.users` |
| `platform` | TEXT | `meta`, `google_ads`, or `linkedin` |
| `plai_user_id` | TEXT | User ID from Plai |
| `platform_account_id` | TEXT | Account ID from platform (e.g., `act_123456`) |
| `account_name` | TEXT | Display name |
| `currency` | TEXT | Currency code (default: USD) |
| `is_active` | BOOLEAN | Connection status |
| `connected_at` | TIMESTAMPTZ | When account was connected |
| `last_synced_at` | TIMESTAMPTZ | Last sync time |
| `plai_account_data` | JSONB | Raw data from Plai |

### `campaigns.mock_campaign_id` Format

**Multi-platform (new):**
```json
{
  "meta": "camp_123456",
  "google_ads": "camp_789012",
  "linkedin": "camp_345678"
}
```

**Legacy (single platform):**
```json
{
  "legacy": "camp_123456"
}
```

### `campaigns.mock_stats` Format

**Per-platform:**
```json
{
  "meta": {
    "spend": 150.50,
    "impressions": 10000,
    "clicks": 250,
    "ctr": 2.5
  },
  "google_ads": {
    "spend": 200.00,
    "impressions": 15000,
    "clicks": 300,
    "ctr": 2.0
  }
}
```

---

## 🔧 Environment Variables

Make sure these are set in your `.env`:

```env
MOCK_API_URL=http://localhost:4001  # Your Plai mock API
MOCK_API_KEY=mock-key               # API key for mock API
```

When you switch to production Plai API:

```env
PLAI_API_URL=https://api.plai.io    # Production Plai API
PLAI_API_KEY=your-production-key    # Production API key
```

The code checks `PLAI_API_URL` first, then falls back to `MOCK_API_URL`.

---

## ✅ Testing Checklist

1. **Run database migrations**
   - ✅ Execute `001_create_ad_accounts_table.sql`
   - ✅ Execute `002_update_profiles_table.sql`

2. **Test subscription flow**
   - ✅ Activate subscription → Creates Plai account
   - ✅ Get connection link → Returns OAuth URL
   - ✅ Sync accounts → Fetches and stores connected accounts

3. **Test campaign creation**
   - ✅ Try creating campaign without connected accounts → Should fail
   - ✅ Connect accounts → Sync accounts
   - ✅ Create campaign with connected accounts → Should succeed
   - ✅ Verify `mock_campaign_id` is stored as JSON

4. **Test metrics sync**
   - ✅ Get campaign overview → Returns metrics
   - ✅ Sync campaign metrics → Updates from Plai

---

## 🚀 Next Steps

1. **Run the database migrations** in Supabase SQL editor
2. **Update environment variables** if needed
3. **Test the new endpoints** using your API client
4. **Update frontend** to use new endpoints:
   - `/subscription/activate` instead of `/subscription/activate-dummy`
   - `/subscription/connect-account` for OAuth flow
   - `/subscription/sync-accounts` after OAuth callback
   - Check for connected accounts before allowing campaign creation

---

## 🐛 Troubleshooting

### "Cuenta Plai no vinculada" error
- Make sure subscription is activated first
- Check that `profiles.plai_user_id` is set

### "No active ad account found for platform" error
- User needs to connect ad accounts first
- Call `/subscription/sync-accounts` after connecting

### Campaign creation fails for some platforms
- Check that user has connected accounts for ALL selected platforms
- Verify accounts are active (`is_active = true`)

### Metrics not syncing
- Check that `mock_campaign_id` is valid JSON
- Verify Plai API is accessible
- Check logs for specific error messages

---

## 📝 Notes

- The old `/subscription/activate-dummy` endpoint still works for backward compatibility
- Existing campaigns with single `mock_campaign_id` will be converted to JSONB format
- The system gracefully handles both legacy and new formats
- All Plai API calls are abstracted in `PlaiApiClient` - easy to switch to production API
