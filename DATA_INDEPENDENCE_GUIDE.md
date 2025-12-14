# 🗄️ Data Independence Guide

## Overview

This guide explains how the system stores all campaign data locally in your database, making it independent from Plai API and enabling offline functionality.

## 📊 Where Data is Stored

### 1. **Campaigns Table** (`campaigns`)
- **Current Metrics Snapshot**: `mock_stats` JSONB column
  - Latest metrics for each platform
  - Updated on every sync
  
- **Sync Tracking**:
  - `last_synced_at`: When metrics were last synced
  - `sync_status`: Current sync status (`pending`, `syncing`, `synced`, `error`)

### 2. **Campaign Metrics History Table** (`campaign_metrics_history`)
- **Time-Series Data**: Historical snapshots of all metrics
- **What's Stored**:
  - Every metric from every sync (creates a historical record)
  - Platform-specific metrics (one row per platform per sync)
  - All calculated metrics (CPA, ROA, etc.)
  - Raw API data for future reference

- **Use Cases**:
  - Analytics and trending
  - Historical comparisons
  - Offline access to past data

### 3. **Campaign Insights Table** (`campaign_insights`)
- **Stored Insights**: Full insights data from Plai API
- **What's Stored**:
  - Complete insights object
  - Recommendations array
  - Metadata (when calculated, data source)
  - Stale flag for cache management

- **Use Cases**:
  - Fast insights loading (no API call needed)
  - Offline insights access
  - Fallback when Plai API is down

## 🔄 Data Flow

### When Campaign is Created
```
1. Campaign created in your DB
2. Campaign created in Plai via API
3. Initial metrics stored in:
   - campaigns.mock_stats (current snapshot)
   - campaign_metrics_history (first historical record)
```

### When Metrics are Synced (`POST /campaigns/:id/sync`)
```
1. Fetch latest metrics from Plai API
2. Update campaigns.mock_stats (current snapshot)
3. Store new snapshot in campaign_metrics_history (historical record)
4. Update campaigns.last_synced_at
5. Update campaigns.sync_status = 'synced'
```

### When Insights are Requested (`GET /campaigns/:id/insights`)
```
1. Check campaign_insights table first
2. If found and fresh (< 24 hours old):
   → Return stored insights (FAST, NO API CALL)
3. If not found or stale:
   → Fetch from Plai API
   → Store in campaign_insights
   → Return to user
4. If Plai API fails:
   → Return stored insights (even if stale)
   → Or generate from local metrics
```

## 📈 Data Sources Priority

The system follows this priority for data:

1. **Local Database (First Priority)**
   - Stored metrics in `campaigns.mock_stats`
   - Historical data in `campaign_metrics_history`
   - Stored insights in `campaign_insights`

2. **Plai API (Fallback)**
   - Only called if local data is missing or stale
   - Results are stored locally for future use

3. **Calculated (Last Resort)**
   - If API fails, calculate from local data
   - Still stored for offline access

## 🗄️ Database Schema

### `campaign_metrics_history`
```sql
- id: UUID (primary key)
- campaign_id: UUID (foreign key)
- platform: TEXT (meta/google_ads/linkedin or NULL)
- recorded_at: TIMESTAMPTZ (when snapshot was taken)
- spend, impressions, clicks, ctr: Core metrics
- conversions, revenue, total_sales: Conversion metrics
- cpa, roa, cost_per_click, cpm, reach: Calculated metrics
- raw_data: JSONB (full API response for reference)
```

### `campaign_insights`
```sql
- id: UUID (primary key)
- campaign_id: UUID (unique, foreign key)
- insights_data: JSONB (full insights from API)
- recommendations: JSONB (array of recommendations)
- calculated_at: TIMESTAMPTZ (when calculated)
- data_source: TEXT (plai_api/calculated/hybrid)
- is_stale: BOOLEAN (cache management)
```

### `campaigns` (New Columns)
```sql
- last_synced_at: TIMESTAMPTZ (last sync timestamp)
- sync_status: TEXT (pending/syncing/synced/error)
```

## 🚀 Benefits of This Architecture

### 1. **Independence from Plai**
- All data stored in your database
- Can work even if Plai API is down
- No vendor lock-in for historical data

### 2. **Fast Performance**
- Insights served from cache (no API delay)
- Historical queries use local database
- Reduced API calls = faster responses

### 3. **Offline Capability**
- Users can view historical data offline
- Cached insights available without internet
- Graceful degradation if API fails

### 4. **Analytics & Reporting**
- Historical data enables trending
- Compare metrics over time
- Custom analytics on your data

### 5. **Cost Efficiency**
- Fewer API calls to Plai
- Reduced latency
- Better user experience

## 🔧 How to Use

### Sync Metrics Manually
```bash
POST /v1/campaigns/:id/sync
Authorization: Bearer <token>
```
This will:
- Fetch latest from Plai
- Update current snapshot
- Store historical record
- Store insights if available

### Get Historical Metrics
Use the `CampaignMetricsHistoryRepository`:
```typescript
const historyRepo = new CampaignMetricsHistoryRepository()

// Get all history for a campaign
const history = await historyRepo.getHistory(campaignId)

// Get history for specific platform
const platformHistory = await historyRepo.getHistory(campaignId, {
  platform: 'meta',
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  limit: 100
})
```

### Automatic Sync (Future Enhancement)
You can set up a cron job or scheduled task to:
- Sync all active campaigns periodically
- Keep data fresh automatically
- Reduce manual syncs

Example (using node-cron):
```typescript
import cron from 'node-cron'

// Sync every 6 hours
cron.schedule('0 */6 * * *', async () => {
  // Get all active campaigns
  // Sync each one
})
```

## 📝 Migration Steps

1. **Run the migration**:
   ```sql
   -- Execute in Supabase SQL editor
   database/migrations/003_add_campaign_metrics_history.sql
   ```

2. **Verify tables created**:
   ```sql
   SELECT * FROM campaign_metrics_history LIMIT 1;
   SELECT * FROM campaign_insights LIMIT 1;
   ```

3. **Test sync**:
   ```bash
   POST /v1/campaigns/:id/sync
   ```

4. **Verify data stored**:
   ```sql
   -- Check history was created
   SELECT * FROM campaign_metrics_history 
   WHERE campaign_id = '<your-campaign-id>'
   ORDER BY recorded_at DESC;
   ```

## 🎯 Next Steps for Full Independence

### 1. **Direct Platform Integration** (Future)
Instead of Plai, connect directly to:
- Meta Ads API
- Google Ads API
- LinkedIn Ads API

Your data structure already supports this!

### 2. **Scheduled Syncs**
Set up automated background jobs to:
- Sync metrics every hour
- Keep insights fresh
- Maintain data independence

### 3. **Data Export/Backup**
Regular backups of:
- `campaign_metrics_history` (historical data)
- `campaign_insights` (insights cache)
- `campaigns.mock_stats` (current snapshots)

### 4. **Analytics Engine**
Build your own analytics on top of:
- Historical metrics data
- Stored insights
- Calculated recommendations

## ❓ FAQ

**Q: How much data will this store?**
A: Each sync creates one row per platform. For 10 campaigns, 3 platforms, syncing daily = ~900 rows/month. Very manageable.

**Q: What if I want to remove old data?**
A: You can create a cleanup job:
```sql
DELETE FROM campaign_metrics_history 
WHERE recorded_at < NOW() - INTERVAL '1 year';
```

**Q: Can I disable Plai API entirely?**
A: Yes! Just remove API calls and use only stored data. The system will work offline.

**Q: How fresh is the data?**
A: As fresh as your last sync. Set up automated syncs for real-time data.

---

## ✅ Summary

✅ **All metrics stored locally**  
✅ **Historical data preserved**  
✅ **Insights cached**  
✅ **Works offline**  
✅ **Fast performance**  
✅ **Future-proof architecture**

Your system is now **independent** and **ready for the future**! 🚀

