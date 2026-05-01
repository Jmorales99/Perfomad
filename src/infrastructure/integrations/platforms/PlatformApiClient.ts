import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export type { Platform }

/**
 * Per-product metrics row returned by product-level Insights calls.
 * Covers Meta Catalog (Dynamic Product Ads) and Google Shopping / PMax.
 * All numeric fields are 0 when no data is available (never null).
 */
export interface ProductInsightsRow {
  product_id: string
  product_title: string | null
  image_url?: string | null
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  roas: number
  raw?: unknown
}

/**
 * Per-campaign metrics row returned by level=campaign Insights calls.
 * All numeric fields are 0 when no data is available (never null).
 */
export interface CampaignInsightsRow {
  campaign_id: string
  name: string
  impressions: number
  clicks: number
  spend: number
  reach: number
  ctr: number
  cpc: number
  cpm: number
  /** Normalized campaign status: 'active' | 'paused' | 'issues' | 'removed' | 'unknown' */
  status?: string
  /** Raw action array from the platform (purchases, leads, etc.). */
  actions: Array<{ action_type: string; value: string }>
  /** Raw action_values array (purchase revenue, etc.). */
  action_values: Array<{ action_type: string; value: string }>
}

/**
 * Aggregated metrics for an ad account over a date range.
 * All numeric fields are 0 when no data is available (never null).
 */
export interface AccountInsights {
  impressions: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
  reach: number
  /** Raw action array from the platform (purchases, leads, etc.). */
  actions: Array<{ action_type: string; value: string }>
  /** Raw action_values array (purchase revenue, etc.). */
  action_values: Array<{ action_type: string; value: string }>
}

/**
 * Parsed creative attached to a single ad.
 * All URL fields are null when not available from the platform.
 */
export interface AdCreative {
  creative_id: string
  /** Derived from the creative spec. "unknown" when no spec is available. */
  type: "image" | "video" | "carousel" | "unknown"
  /** Best available preview image (video thumbnail, first card, or ad image). */
  thumbnail_url: string | null
  /** Full image URL for single-image ads. */
  image_url: string | null
  /**
   * Direct video playback URL (Meta: /{video_id}?fields=source).
   * Only present for video creatives after enrichment.
   */
  video_url?: string | null
  /** Google Shopping: Merchant Center merchant ID — set for SHOPPING campaigns, triggers product enrichment. */
  merchant_id?: string | null
  /** Non-empty only for carousel/multi-image creatives. */
  cards: Array<{
    /** Low-res preview returned directly by the platform. */
    thumbnail_url: string | null
    /** Full-resolution image URL, populated by enrichment when available. */
    image_url?: string | null
    /** Direct video playback URL for carousels with videos. */
    video_url?: string | null
    link: string | null
    name: string | null
  }>
}

/** Single ad with creative metadata, as returned by the platform ads endpoint. */
export interface AdDetail {
  ad_id: string
  name: string
  status: string
  effective_status: string
  creative: AdCreative
}

/**
 * Single-day metrics row returned by daily insights endpoints.
 * Used to backfill campaign_metrics_history for imported campaigns.
 */
export interface DailyInsightsRow {
  /** YYYY-MM-DD */
  date: string
  impressions: number
  clicks: number
  spend: number
  reach: number
  ctr: number
  cpc: number
  cpm: number
  conversions: number
  revenue: number
  actions: Array<{ action_type: string; value: string }>
  action_values: Array<{ action_type: string; value: string }>
}

/**
 * Budget snapshot returned by the platform for a specific campaign.
 * daily/lifetime are in the account currency (not cents/micros).
 */
export interface CampaignBudgetSnapshot {
  campaign_id: string
  daily_budget: number | null
  lifetime_budget: number | null
  spend_to_date: number | null
  status: string | null
  /** Campaign name as returned by the platform — fallback when listCampaigns() misses the entry. */
  name?: string | null
  /** Actual campaign start date from the platform (ISO 8601). Only populated when the platform returns it. */
  start_date?: string | null
  currency?: string
  raw?: unknown
}

/**
 * Summary of an ad set (Meta) / ad group (Google Ads) / adgroup (TikTok).
 * Fields are normalized across platforms; platform-specific extras live in `raw`.
 */
export interface AdSetSummary {
  adset_id: string
  name: string
  status: string
  daily_budget?: number | null
  lifetime_budget?: number | null
  /** Where the budget numbers apply (Meta: ad set; Google Ads: usually campaign-level). */
  budget_scope?: "campaign" | "adset" | null
  optimization_goal?: string | null
  targeting_summary?: string | null
  impressions?: number
  clicks?: number
  spend?: number
  ctr?: number
  /** Normalized metrics for UIs that expect a nested object (see ListCampaignAdSets). */
  metrics?: {
    impressions?: number
    clicks?: number
    spend?: number
  }
  raw?: unknown
}

/**
 * Per-ad metrics row returned by a level=ad Insights call filtered to one campaign.
 * All numeric fields are 0 when no data is available.
 */
export interface AdInsightsRow {
  ad_id: string
  impressions: number
  clicks: number
  spend: number
  reach: number
  ctr: number
  cpc: number
  cpm: number
  actions: Array<{ action_type: string; value: string }>
  action_values: Array<{ action_type: string; value: string }>
}

/**
 * Base interface for all platform API clients
 */
export interface PlatformApiClient {
  getOAuthUrl(redirectUri: string, state: string): string
  exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn: number
  }>
  getAdAccounts(accessToken: string): Promise<Array<{
    id: string
    name: string
    currency?: string
    [key: string]: any
  }>>
  /**
   * Returns aggregated account-level insights for a given date range.
   * `platformAccountId` is the platform's own account identifier (e.g. Meta's act_xxx).
   */
  getAccountInsights(
    platformAccountId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<AccountInsights>
  /**
   * Returns per-campaign insights (level=campaign) for all campaigns under the given
   * ad account. Results are ordered by spend descending.
   */
  getAdAccountCampaignInsights(
    platformAccountId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<CampaignInsightsRow[]>
  /**
   * Returns all ads belonging to a campaign, including parsed creative metadata.
   * Does NOT download media — only returns URL strings.
   */
  getCampaignAds(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<AdDetail[]>
  /**
   * Returns per-ad Insights (level=ad) filtered to a single campaign.
   * `platformAccountId` is the platform's own account identifier (e.g. act_xxx for Meta).
   */
  getAdInsights(
    platformAccountId: string,
    campaignId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<AdInsightsRow[]>
  createCampaign(params: {
    adAccountId: string
    name: string
    dailyBudget?: number
    lifetimeBudget?: number
    objective?: string
    status?: string
    startDate?: string
    endDate?: string | null
    [key: string]: any
  }, accessToken: string): Promise<{ campaignId: string; rawData: any }>
  getCampaignMetrics(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<any>
  getCampaignInsights(
    campaignId: string,
    accessToken: string,
    dateRange?: { startDate?: string; endDate?: string },
    options?: { platformAccountId?: string }
  ): Promise<any>
  updateCampaignStatus(
    campaignId: string,
    status: "ACTIVE" | "PAUSED" | "ARCHIVED",
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<void>
  updateCampaignBudget(
    campaignId: string,
    budget: number,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<void>
  listCampaigns(
    adAccountId: string,
    accessToken: string
  ): Promise<Array<{ id: string; name: string; status: string; [key: string]: any }>>
  /**
   * Returns the current budget + spend snapshot for a single campaign
   * (used for drift detection and the "source of truth" decision).
   */
  getCampaignBudget(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<CampaignBudgetSnapshot>
  /**
   * Returns a lightweight list of ad sets / ad groups / adgroups inside a campaign
   * (Meta: adsets, Google Ads: ad_groups, TikTok: adgroups).
   * Metrics are optional — implementations may return 0 when not cheaply available.
   */
  listCampaignAdSets(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string; dateRange?: { since: string; until: string } }
  ): Promise<AdSetSummary[]>
  /**
   * Returns all ads belonging to a single ad set / ad group, with creative details.
   * Used for lazy-loading creatives in the frontend.
   */
  listAdSetAds(
    adSetId: string,
    accessToken: string,
    options?: { platformAccountId?: string; campaignId?: string }
  ): Promise<AdDetail[]>
  /**
   * Returns daily metrics for a campaign from its creation date to today (lifetime).
   * Used to backfill campaign_metrics_history when an existing platform campaign is imported.
   * Each row covers one calendar day. Implementations should use date_preset=lifetime
   * with time_increment=1 (Meta) or GAQL segmented by segments.date (Google Ads).
   */
  getCampaignDailyInsights(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string; since?: string; until?: string }
  ): Promise<DailyInsightsRow[]>
  /**
   * Pauses or resumes a single ad (not the campaign).
   * Used when applying a pause_ad optimization recommendation.
   */
  updateAdStatus(
    adId: string,
    status: "ACTIVE" | "PAUSED",
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<void>
  /**
   * Returns per-product metrics for an ad account (Meta Catalog / Google Shopping / PMax).
   * If the account has no catalog or Shopping campaigns, returns [].
   * Optionally filtered to a single campaign via options.campaignId.
   */
  getProductInsights(
    adAccountId: string,
    accessToken: string,
    options?: { campaignId?: string; since?: string; until?: string }
  ): Promise<ProductInsightsRow[]>
}

export interface PlatformClientConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  apiVersion?: string
  [key: string]: any
}
