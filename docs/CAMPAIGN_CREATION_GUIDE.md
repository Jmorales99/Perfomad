# 📢 Campaign Creation Guide - Realistic Meta Ads Parameters

## 🎯 Overview

This guide explains how to create campaigns with realistic Meta (Facebook) Ads API parameters. The system now supports all the fields that Meta actually requires when creating campaigns.

## 📋 Campaign Creation Endpoint

```
POST /v1/campaigns
Authorization: Bearer <token>
```

## 📝 Request Body

### Required Fields

```json
{
  "name": "Summer Sale Campaign",
  "platforms": ["meta"]
}
```

### Optional Fields (Realistic Meta Parameters)

```json
{
  "name": "Summer Sale Campaign",
  "platforms": ["meta", "google_ads"],
  "description": "Campaign for summer product promotion",
  
  // Budget (choose one)
  "budget_usd": 50.00,        // Daily budget in USD
  // OR
  "lifetime_budget": 1500.00,  // Lifetime budget (total for campaign)
  
  // Campaign Objective (Meta)
  "objective": "OUTCOME_TRAFFIC", // What you want to achieve
  
  // Billing Event (What you pay for)
  "billing_event": "IMPRESSIONS", // What Meta charges for
  
  // Bid Strategy
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP", // How Meta bids for you
  
  // Status
  "status": "ACTIVE", // ACTIVE or PAUSED
  
  // Special Ad Categories (Compliance)
  "special_ad_categories": [], // HOUSING, EMPLOYMENT, CREDIT
  
  // Dates
  "start_date": "2024-06-01T00:00:00Z",
  "end_date": "2024-06-30T23:59:59Z",
  
  // Meta-specific settings
  "meta_settings": {
    "promoted_object": {
      "object_store_url": "https://yourstore.com",
      "custom_event_type": "PURCHASE"
    }
  }
}
```

## 🎯 Campaign Objectives (Meta)

Meta supports various campaign objectives. Choose based on your goal:

| Objective | Use Case | Description |
|-----------|----------|-------------|
| `OUTCOME_TRAFFIC` | Drive website traffic | Get people to visit your website |
| `OUTCOME_SALES` | Drive purchases | Get people to buy your products |
| `OUTCOME_ENGAGEMENT` | Get engagement | Likes, comments, shares |
| `OUTCOME_LEADS` | Generate leads | Collect contact information |
| `OUTCOME_APP_PROMOTION` | Promote app | Get app installs |
| `OUTCOME_AWARENESS` | Build awareness | Reach more people |
| `OUTCOME_VIDEO_VIEWS` | Video views | Get people to watch your videos |

**Default**: `OUTCOME_TRAFFIC`

## 💰 Budget Options

### Daily Budget
```json
{
  "budget_usd": 50.00
}
```
- Budget per day
- Campaign runs daily with this budget
- Good for ongoing campaigns

### Lifetime Budget
```json
{
  "lifetime_budget": 1500.00
}
```
- Total budget for entire campaign
- Campaign stops when budget is spent
- Good for time-limited campaigns

**Note**: Use **one or the other**, not both!

## 💳 Billing Events (What You Pay For)

| Billing Event | Description |
|---------------|-------------|
| `IMPRESSIONS` | Pay per 1,000 impressions (views) |
| `LINK_CLICKS` | Pay per click |
| `OFFER_CLAIMS` | Pay per offer claim |
| `PAGE_LIKES` | Pay per page like |
| `POST_ENGAGEMENT` | Pay per engagement |

**Default**: `IMPRESSIONS`

## 🎲 Bid Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `LOWEST_COST_WITHOUT_CAP` | Meta optimizes for lowest cost | Getting started, learning |
| `COST_CAP` | Control maximum cost per result | Budget control |
| `BID_CAP` | Set maximum bid amount | Advanced optimization |
| `TARGET_COST` | Target specific cost per result | Consistent performance |

**Default**: `LOWEST_COST_WITHOUT_CAP`

## 🚨 Special Ad Categories (Compliance)

For certain industries, you **must** specify special ad categories:

```json
{
  "special_ad_categories": ["HOUSING"]
}
// OR
{
  "special_ad_categories": ["EMPLOYMENT"]
}
// OR
{
  "special_ad_categories": ["CREDIT"]
}
```

**Required for**:
- Housing ads (rental, sales)
- Employment ads (job postings)
- Credit/financial services

Leave empty `[]` if not applicable.

## 📅 Dates

```json
{
  "start_date": "2024-06-01T00:00:00Z",  // ISO 8601 format
  "end_date": "2024-06-30T23:59:59Z"     // Optional, null for ongoing
}
```

- `start_date`: When campaign should start
- `end_date`: When campaign should end (null = ongoing)

## 🎨 Complete Example Request

### Example 1: E-commerce Traffic Campaign

```json
{
  "name": "Summer Sale - Website Traffic",
  "platforms": ["meta"],
  "description": "Drive traffic to summer sale landing page",
  "budget_usd": 50.00,
  "objective": "OUTCOME_TRAFFIC",
  "billing_event": "LINK_CLICKS",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "status": "ACTIVE",
  "special_ad_categories": [],
  "start_date": "2024-06-01T00:00:00Z",
  "end_date": "2024-06-30T23:59:59Z"
}
```

### Example 2: Sales Campaign with Lifetime Budget

```json
{
  "name": "Product Launch - Sales",
  "platforms": ["meta"],
  "budget_usd": null,
  "lifetime_budget": 2000.00,
  "objective": "OUTCOME_SALES",
  "billing_event": "IMPRESSIONS",
  "bid_strategy": "COST_CAP",
  "status": "ACTIVE",
  "start_date": "2024-07-01T00:00:00Z",
  "meta_settings": {
    "promoted_object": {
      "object_store_url": "https://mystore.com/products",
      "custom_event_type": "PURCHASE"
    }
  }
}
```

### Example 3: Housing Ad (Compliance Required)

```json
{
  "name": "Apartment Rental",
  "platforms": ["meta"],
  "budget_usd": 30.00,
  "objective": "OUTCOME_LEADS",
  "special_ad_categories": ["HOUSING"], // REQUIRED for housing ads
  "status": "ACTIVE"
}
```

## ✅ Response

Successful response includes:

```json
{
  "id": "campaign-uuid",
  "name": "Summer Sale Campaign",
  "platforms": ["meta"],
  "budget_usd": 50.00,
  "status": "active",
  "mock_campaign_id": {
    "meta": "camp_123456789"
  },
  "raw_data_plai": {
    "meta": { /* RAW response from Plai */ }
  },
  "mock_stats": {
    "meta": {
      "spend": 0,
      "impressions": 0,
      "clicks": 0,
      "ctr": 0,
      "cpa": null,
      "roa": null
    }
  },
  "created_at": "2024-01-01T00:00:00Z"
}
```

## 🔍 Validation

The API validates:

1. ✅ User has active subscription
2. ✅ User has connected ad account for selected platforms
3. ✅ Required fields present (name, platforms)
4. ✅ Budget is provided (daily OR lifetime)
5. ✅ Dates are valid (start < end if both provided)
6. ✅ Objective is valid Meta objective
7. ✅ Special ad categories if required by objective

## 🐛 Common Errors

### Missing Ad Account
```json
{
  "error": "Cuentas de publicidad no conectadas",
  "message": "Conecta tus cuentas primero para: meta",
  "missing_platforms": ["meta"]
}
```

**Solution**: Connect your Meta ad account first via `/v1/subscription/sync-accounts`

### Invalid Budget
```json
{
  "error": "Invalid budget",
  "message": "Provide either budget_usd (daily) OR lifetime_budget, not both"
}
```

**Solution**: Use only one budget type

### Invalid Objective
```json
{
  "error": "Invalid objective",
  "message": "Objective must be a valid Meta objective"
}
```

**Solution**: Use valid Meta objective (see list above)

---

## 📚 References

- [Meta Marketing API - Campaign Creation](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group)
- [Plai API Documentation](https://docs.plai.io/introduction)

---

**Your campaigns now use realistic Meta Ads parameters! 🚀**


