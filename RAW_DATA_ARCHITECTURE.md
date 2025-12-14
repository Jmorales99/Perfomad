# 📦 Raw Data Architecture Guide

## 🎯 Goal

**Store RAW data from Plai API → Calculate metrics FROM stored data → Easy migration to Meta/Google Ads**

## 🔄 New Data Flow

### Current Architecture (What You Asked For)

```
┌──────────────┐
│  Plai API    │ (or Meta/Google Ads in future)
└──────┬───────┘
       │ 1. Fetch RAW data
       ▼
┌─────────────────────────────┐
│  Your Database              │
│  • raw_data_plai (JSONB)    │ ← Store RAW response
│  • mock_stats (calculated)  │ ← Calculated from raw
└──────┬──────────────────────┘
       │ 2. Calculate metrics FROM raw data
       ▼
┌─────────────────────────────┐
│  MetricsCalculator Service  │
│  • CPA, ROA, CTR, etc.      │ ← Independent calculation
└──────┬──────────────────────┘
       │ 3. Return calculated metrics
       ▼
┌──────────────┐
│  Your API    │
└──────────────┘
```

## 📊 Key Components

### 1. **MetricsCalculator Service** (`src/application/services/MetricsCalculator.ts`)

**Purpose**: Calculate all metrics from raw data (independent of data source)

**Features**:
- Works with ANY data source (Plai, Meta, Google Ads)
- Single source of truth for calculations
- Handles different data formats automatically

**Usage**:
```typescript
import { MetricsCalculator } from "@/application/services/MetricsCalculator"

// Calculate from raw Plai data
const rawData = { spend: 100, clicks: 50, conversions: 5, ... }
const metrics = MetricsCalculator.calculateFromRaw(rawData)
// Returns: { spend, clicks, ctr, cpa, roa, ... }

// Calculate from stored database data
const metrics = MetricsCalculator.calculateFromStored(campaign.raw_data_plai)
```

### 2. **Raw Data Storage**

**In Database**:
- `campaigns.raw_data_plai` (JSONB): Stores RAW response from Plai API
- `campaign_metrics_history.raw_data` (JSONB): Historical raw data snapshots

**Why Store Raw?**:
- ✅ Recalculate metrics anytime (if calculation logic changes)
- ✅ Debug issues with original data
- ✅ Switch data sources easily (just change what populates `raw_data_plai`)
- ✅ Future-proof for different API formats

### 3. **Updated Sync Flow**

**Before** (WRONG):
```
Fetch from Plai → Calculate → Store calculated → Return
```

**Now** (CORRECT):
```
1. Fetch RAW from Plai
2. Store RAW in raw_data_plai
3. Calculate metrics FROM raw_data_plai (using MetricsCalculator)
4. Store calculated in mock_stats (for quick access)
5. Return calculated metrics
```

## 🔧 How It Works

### Step 1: Fetch Raw Data from Plai

```typescript
// PlaiApiClient.getCampaignOverview()
const { data } = await this.client.get(`/meta/campaign/${campaignId}/overview`)

// Return RAW data (no calculations!)
return {
  rawData: data.results.metrics, // Raw response
  metrics: { ... } // For backward compatibility
}
```

### Step 2: Store Raw Data

```typescript
// SyncCampaignMetrics.execute()
const overview = await this.plaiApi.getCampaignOverview(campaignId)

// Store RAW data in database
await this.campaignsRepo.update(userId, campaignId, {
  raw_data_plai: overview.rawData, // ← RAW data stored here
  // ...
})
```

### Step 3: Calculate from Raw Data

```typescript
// Using MetricsCalculator
const calculatedMetrics = MetricsCalculator.calculateFromRaw(overview.rawData)

// Now you have:
// - cpa (calculated)
// - roa (calculated)
// - ctr (normalized to decimal)
// - etc.
```

### Step 4: Use Calculated Metrics

```typescript
// Store calculated for quick access
await this.campaignsRepo.update(userId, campaignId, {
  mock_stats: calculatedMetrics, // ← Quick access
  raw_data_plai: overview.rawData, // ← Source of truth
})
```

## 🔄 Getting Metrics (From Stored Data)

When you need metrics, calculate from stored RAW data:

```typescript
// Get campaign
const campaign = await campaignsRepo.findById(userId, campaignId)

// Calculate from stored raw data
if (campaign.raw_data_plai) {
  const metrics = MetricsCalculator.calculateFromRaw(campaign.raw_data_plai)
  // Use metrics...
}
```

## 🚀 Future Migration to Meta/Google Ads

### When switching from Plai to Meta/Google Ads:

**1. Create new API client** (similar to PlaiApiClient):
```typescript
class MetaAdsClient {
  async getCampaignOverview(campaignId: string) {
    // Fetch from Meta API
    const data = await metaApi.getCampaign(campaignId)
    
    // Return RAW data (same format as Plai!)
    return {
      rawData: {
        spend: data.spend,
        impressions: data.impressions,
        clicks: data.clicks,
        // ... same structure
      }
    }
  }
}
```

**2. Update SyncCampaignMetrics**:
```typescript
// Just change the API client!
const overview = await metaAdsClient.getCampaignOverview(campaignId)

// Store in SAME place (could rename to raw_data_meta)
await this.campaignsRepo.update(userId, campaignId, {
  raw_data_plai: overview.rawData, // Or raw_data_meta
})
```

**3. MetricsCalculator works the same!**
```typescript
// No changes needed! Works with any raw data source
const metrics = MetricsCalculator.calculateFromRaw(rawDataFromMeta)
```

## 📋 Database Schema

### `campaigns` Table

```sql
- raw_data_plai: JSONB  -- RAW response from Plai (or any source)
- mock_stats: JSONB     -- Calculated metrics (for quick access)
- last_synced_at: TIMESTAMPTZ
- sync_status: TEXT
```

### Example `raw_data_plai`:

```json
{
  "meta": {
    "spend": 150.50,
    "impressions": 10000,
    "clicks": 250,
    "ctr": 2.5,  // Can be percentage or decimal
    "conversions": 10,
    "revenue": 500.00,
    // ... any other fields from Plai
  }
}
```

## ✅ Benefits

1. **Source Independence**
   - Calculation logic separate from data source
   - Easy to switch between Plai, Meta, Google Ads

2. **Data Integrity**
   - Always store original data
   - Can recalculate if needed
   - Debug with original responses

3. **Flexibility**
   - Add new metrics by updating MetricsCalculator
   - Support new data sources easily
   - No vendor lock-in

4. **Performance**
   - Calculate from stored data (no API call needed)
   - Fast metric retrieval
   - Historical calculations possible

## 🔍 Example: Getting Metrics

### Endpoint: `GET /campaigns/:id/overview`

**Flow**:
1. Get campaign from database
2. Check if `raw_data_plai` exists
3. If yes: Calculate from stored raw data
4. If no: Fetch from Plai (legacy fallback)
5. Return calculated metrics

**Code**:
```typescript
const campaign = await campaignsRepo.findById(userId, campaignId)

if (campaign.raw_data_plai) {
  // Calculate from stored raw data
  const metrics = MetricsCalculator.calculateFromRaw(campaign.raw_data_plai)
  return { metrics, from_stored: true }
} else {
  // Fallback: fetch from Plai
  const overview = await plaiApi.getCampaignOverview(campaignId)
  return { metrics: overview.metrics, from_stored: false }
}
```

## 📝 Migration Steps

1. **Run migration**:
   ```sql
   -- Execute in Supabase SQL editor
   database/migrations/004_add_raw_data_storage.sql
   ```

2. **Test sync**:
   ```bash
   POST /v1/campaigns/:id/sync
   ```
   This will now:
   - Fetch RAW from Plai
   - Store in `raw_data_plai`
   - Calculate from raw
   - Store calculated metrics

3. **Verify raw data**:
   ```sql
   SELECT raw_data_plai FROM campaigns WHERE id = '<campaign-id>';
   ```

4. **Test metrics calculation**:
   ```bash
   GET /v1/campaigns/:id/overview
   ```
   Should return metrics calculated from stored raw data.

## 🎯 Summary

✅ **Raw data stored** from Plai API  
✅ **Metrics calculated** from stored raw data  
✅ **Independent** calculation service  
✅ **Easy migration** to Meta/Google Ads (just change data source)  
✅ **Single source of truth** for calculations  

Your system is now **future-proof** and **source-independent**! 🚀

