import type { Campaign } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import type { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { OptimizationConfig } from "@/infrastructure/repositories/OptimizationConfigRepository"
import type { BenchmarksRepository } from "@/infrastructure/repositories/BenchmarksRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import {
  OPTIMIZATION_INPUT_VERSION,
  optimizationInputSchema,
  type OptimizationInput,
  type OptimizationInputBudget,
  type ActiveAdSummary,
} from "./schemas/OptimizationInput"

export interface BuildInputResult {
  ok: true
  input: OptimizationInput
}

export interface InsufficientDataResult {
  ok: false
  reason: "insufficient_data"
  details: { days_active: number; spend: number; min_days: number; min_spend: number }
}

export type BuildOptimizationInputResult = BuildInputResult | InsufficientDataResult

export interface BuildOptimizationInputDeps {
  metricsHistoryRepo: CampaignMetricsHistoryRepository
  benchmarksRepo: BenchmarksRepository
  adAccountsRepo: SupabaseAdAccountsRepository
}

export interface BuildOptimizationInputParams {
  campaign: Campaign
  platformSupport: "automatic" | "manual_required" | "unsupported"
  config: OptimizationConfig
  /** Period window in days. Defaults to 30. */
  periodDays?: number
}

/**
 * Composes a stable OptimizationInput v1 payload for the LLM.
 *
 * - Uses historical snapshots from campaign_metrics_history.
 * - Reads benchmarks optionally (omitted when unavailable).
 * - Applies minimum-data policy; returns "insufficient_data" when unmet.
 */
export class BuildOptimizationInput {
  private tokenManager = new TokenManager()

  constructor(private readonly deps: BuildOptimizationInputDeps) {}

  async execute(params: BuildOptimizationInputParams): Promise<BuildOptimizationInputResult> {
    const { campaign, platformSupport, config } = params
    const periodDays = params.periodDays ?? 30

    const platform = pickPrimaryPlatform(campaign)
    const budget = this.buildBudget(campaign)
    const period = buildPeriod(periodDays)

    const history = await this.deps.metricsHistoryRepo.getHistory(campaign.id, {
      platform,
      startDate: period.since,
      limit: 200,
    })

    const metrics = aggregateMetrics(history, campaign)
    const daysActive = computeDaysActive(campaign)

    if (
      daysActive < config.min_days_before_action ||
      metrics.spend < config.min_spend_before_action
    ) {
      return {
        ok: false,
        reason: "insufficient_data",
        details: {
          days_active: daysActive,
          spend: metrics.spend,
          min_days: config.min_days_before_action,
          min_spend: config.min_spend_before_action,
        },
      }
    }

    const spendTier = pickSpendTier(metrics.spend)
    const benchmarksSnapshot = await this.deps.benchmarksRepo
      .getLatestForSegment({
        platform,
        objective: campaign.objective ?? null,
        country: null,
        spend_tier: spendTier,
      })
      .catch(() => null)

    const historyPoints = buildHistoryPoints(history).slice(-30)

    // Fetch active ads (best-effort — failures do not block optimization).
    const activeAds = await this.fetchActiveAds(campaign, platform, period).catch(() => undefined)

    const rawInput: OptimizationInput = {
      version: OPTIMIZATION_INPUT_VERSION,
      generated_at: new Date().toISOString(),
      campaign: {
        id: campaign.id,
        name: campaign.name,
        platform,
        objective: campaign.objective ?? null,
        country: null,
        status: normalizeStatus(campaign.status),
        start_date: campaign.start_date ?? null,
        days_active: daysActive,
      },
      budget,
      metrics_period: period,
      metrics,
      benchmarks: benchmarksSnapshot && Object.keys(benchmarksSnapshot.metrics).length > 0
        ? ({
            version: benchmarksSnapshot.version,
            segment: benchmarksSnapshot.segment ?? undefined,
            metrics: Object.fromEntries(
              Object.entries(benchmarksSnapshot.metrics).map(([k, v]) => [
                k,
                {
                  p25: v.p25,
                  p50: v.p50,
                  p75: v.p75,
                  p90: v.p90,
                  sample_size: v.sample_size,
                  source: "internal" as const,
                },
              ])
            ),
          } as OptimizationInput["benchmarks"])
        : undefined,
      history: historyPoints.length > 0 ? historyPoints : undefined,
      active_ads: activeAds && activeAds.length > 0 ? activeAds : undefined,
      policy: {
        allowed_actions: [
          ...config.allowed_actions,
          "pause_ad",
          "flag_creative",
        ] as OptimizationInput["policy"]["allowed_actions"],
        max_budget_adjust_pct: config.max_budget_adjust_pct,
        min_days_before_action: config.min_days_before_action,
        min_spend_before_action: config.min_spend_before_action,
        platform_support: platformSupport,
      },
    }

    const parsed = optimizationInputSchema.parse(rawInput)
    return { ok: true, input: parsed }
  }

  private async fetchActiveAds(
    campaign: Campaign,
    platform: "meta" | "google_ads" | "linkedin" | "tiktok",
    period: OptimizationInput["metrics_period"]
  ): Promise<ActiveAdSummary[] | undefined> {
    const campaignPlatformId = resolvePlatformCampaignId(campaign as any, platform)
    if (!campaignPlatformId) return undefined

    const clientId = (campaign as any).client_id
    if (!clientId) return undefined

    const adAccount = await this.deps.adAccountsRepo.findByUserClientAndPlatform(
      campaign.user_id,
      clientId,
      platform
    )
    if (!adAccount) return undefined

    const client = PlatformApiClientFactory.createClient(platform)
    const accessToken = await this.tokenManager.getValidAccessToken(
      adAccount as any,
      async (rt: string) => client.refreshAccessToken(rt)
    )

    const [adDetails, adInsights] = await Promise.all([
      client.getCampaignAds(campaignPlatformId, accessToken, {
        platformAccountId: adAccount.platform_account_id,
      }).catch(() => []),
      client.getAdInsights(
        adAccount.platform_account_id,
        campaignPlatformId,
        accessToken,
        { since: period.since, until: period.until }
      ).catch(() => []),
    ])

    const metricsById = new Map(adInsights.map((r) => [r.ad_id, r]))

    // Keep only active ads, merge with metrics, cap at 10 by spend.
    const active = adDetails
      .filter((ad) => {
        const s = (ad.effective_status ?? ad.status ?? "").toUpperCase()
        return s === "ACTIVE" || s === "ENABLED"
      })
      .map((ad) => {
        const m = metricsById.get(ad.ad_id)
        const spend = m?.spend ?? 0
        const impressions = m?.impressions ?? 0
        const clicks = m?.clicks ?? 0
        const ctr = m?.ctr ?? (impressions > 0 ? clicks / impressions : 0)
        const cpc = m?.cpc ?? (clicks > 0 ? spend / clicks : 0)
        const conversions = m
          ? m.actions
              .filter((a) => a.action_type === "purchase" || a.action_type === "conversion")
              .reduce((s, a) => s + Number(a.value || 0), 0)
          : 0
        const cpa = conversions > 0 ? spend / conversions : null
        return {
          ad_id: ad.ad_id,
          name: ad.name,
          spend,
          impressions,
          clicks,
          ctr,
          cpc,
          conversions,
          cpa,
          creative_type: ad.creative?.type,
        } satisfies ActiveAdSummary
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10)

    return active.length > 0 ? active : undefined
  }

  private buildBudget(campaign: Campaign): OptimizationInputBudget {
    const c = campaign as any
    const localDaily = numberOrNull(c.budget_local_daily) ?? numberOrNull(c.budget_usd)
    const localLifetime =
      numberOrNull(c.budget_local_lifetime) ?? numberOrNull(c.lifetime_budget)
    const platformDaily = numberOrNull(c.budget_platform_daily)
    const platformLifetime = numberOrNull(c.budget_platform_lifetime)
    const drift = numberOrNull(c.budget_drift_pct)
    const sourceOfTruth = (c.budget_source_of_truth as "local" | "platform") || "platform"

    return {
      local_daily: localDaily,
      local_lifetime: localLifetime,
      platform_daily: platformDaily,
      platform_lifetime: platformLifetime,
      source_of_truth: sourceOfTruth,
      drift_pct: drift,
      spend_total: Number(campaign.spend_usd ?? 0),
      spend_period: Number(campaign.spend_usd ?? 0),
      currency: "USD",
    }
  }
}

// ──────────────────────────────── helpers ───────────────────────────────────

function resolvePlatformCampaignId(campaign: any, platform: string): string | null {
  const field = campaign.platform_campaign_id || campaign.mock_campaign_id
  if (!field) return null
  try {
    const parsed = typeof field === "string" ? JSON.parse(field) : field
    return parsed?.[platform] ?? null
  } catch {
    return null
  }
}

function pickPrimaryPlatform(campaign: Campaign): "meta" | "google_ads" | "linkedin" | "tiktok" {
  if (Array.isArray(campaign.platforms) && campaign.platforms.length > 0) {
    return campaign.platforms[0]
  }
  return "meta"
}

function buildPeriod(days: number): OptimizationInput["metrics_period"] {
  const until = new Date()
  const since = new Date()
  since.setDate(since.getDate() - days)
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    days,
  }
}

function aggregateMetrics(
  history: Array<any>,
  campaign: Campaign
): OptimizationInput["metrics"] {
  if (history.length === 0) {
    return {
      impressions: 0,
      clicks: 0,
      spend: Number(campaign.spend_usd ?? 0),
      reach: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
      conversions: 0,
      revenue: 0,
      cpa: null,
      roa: null,
      conversion_rate: null,
      frequency: null,
    }
  }

  let impressions = 0,
    clicks = 0,
    spend = 0,
    reach = 0,
    conversions = 0,
    revenue = 0
  for (const snap of history) {
    impressions += toNum(snap.impressions)
    clicks += toNum(snap.clicks)
    spend += toNum(snap.spend)
    reach += toNum(snap.reach)
    conversions += toNum(snap.conversions)
    revenue += toNum(snap.revenue ?? snap.total_sales)
  }

  const ctr = impressions > 0 ? clicks / impressions : 0
  const cpc = clicks > 0 ? spend / clicks : 0
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0
  const cpa = conversions > 0 ? spend / conversions : null
  const roa = spend > 0 && revenue > 0 ? revenue / spend : null
  const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : null
  const frequency = reach > 0 ? impressions / reach : null

  return {
    impressions,
    clicks,
    spend,
    reach,
    ctr,
    cpc,
    cpm,
    conversions,
    revenue,
    cpa,
    roa,
    conversion_rate: conversionRate,
    frequency,
  }
}

function buildHistoryPoints(history: Array<any>): OptimizationInput["history"] extends infer T
  ? T extends Array<infer U>
    ? U[]
    : never
  : never {
  return (history || [])
    .map((snap) => {
      const recordedAt = snap.recorded_at || new Date().toISOString()
      return {
        date: new Date(recordedAt).toISOString().slice(0, 10),
        spend: toNum(snap.spend),
        impressions: toNum(snap.impressions),
        clicks: toNum(snap.clicks),
        conversions: toNum(snap.conversions),
        revenue: toNum(snap.revenue ?? snap.total_sales),
      }
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function computeDaysActive(campaign: Campaign): number {
  if (!campaign.start_date) return 0
  const start = new Date(campaign.start_date).getTime()
  if (Number.isNaN(start)) return 0
  const diff = Date.now() - start
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function pickSpendTier(spend: number): "xs" | "s" | "m" | "l" | "xl" {
  if (spend < 100) return "xs"
  if (spend < 500) return "s"
  if (spend < 2500) return "m"
  if (spend < 10000) return "l"
  return "xl"
}

function normalizeStatus(
  status: string | undefined
): "active" | "paused" | "completed" | "removed" | "unknown" {
  const s = (status || "").toLowerCase()
  if (s === "active") return "active"
  if (s === "paused") return "paused"
  if (s === "completed") return "completed"
  if (s === "removed") return "removed"
  return "unknown"
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
