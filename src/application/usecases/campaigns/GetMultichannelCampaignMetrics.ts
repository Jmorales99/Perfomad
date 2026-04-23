import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { SupabaseMultichannelCampaignsRepository } from "@/infrastructure/repositories/SupabaseMultichannelCampaignsRepository"

export interface MetricsTotals {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  reach: number
  ctr: number
  cpc: number
  cpm: number
  cpa?: number
  roas?: number
}

export interface TimeseriesEntry {
  date: string
  consolidated: MetricsTotals
  by_platform: Record<string, MetricsTotals>
}

export interface GetMultichannelCampaignMetricsResult {
  period: { since: string; until: string }
  consolidated: MetricsTotals
  by_platform: Record<string, MetricsTotals>
  timeseries: TimeseriesEntry[]
}

function computeKpis(
  spend: number,
  impressions: number,
  clicks: number,
  conversions: number,
  revenue: number,
  reach: number
): MetricsTotals {
  return {
    spend,
    impressions,
    clicks,
    conversions,
    revenue,
    reach,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa: conversions > 0 ? spend / conversions : undefined,
    roas: spend > 0 && revenue > 0 ? revenue / spend : undefined,
  }
}

interface RawRow {
  platform: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  reach: number
}

export class GetMultichannelCampaignMetrics {
  private mcRepo: SupabaseMultichannelCampaignsRepository

  constructor() {
    this.mcRepo = new SupabaseMultichannelCampaignsRepository()
  }

  async execute(
    userId: string,
    multichannelCampaignId: string,
    since: string,
    until: string
  ): Promise<GetMultichannelCampaignMetricsResult> {
    const parent = await this.mcRepo.findById(userId, multichannelCampaignId)
    if (!parent) throw new Error("Multichannel campaign not found")

    // Fetch campaigns linked to this multichannel parent
    const { data: campaigns, error: campErr } = await supabaseAdmin
      .from("campaigns")
      .select("id")
      .eq("multichannel_campaign_id", multichannelCampaignId)
      .eq("user_id", userId)

    if (campErr) throw campErr
    if (!campaigns || campaigns.length === 0) {
      return {
        period: { since, until },
        consolidated: computeKpis(0, 0, 0, 0, 0, 0),
        by_platform: {},
        timeseries: [],
      }
    }

    const campaignIds = campaigns.map((c) => c.id)

    // Fetch daily aggregated metrics
    const { data: rows, error } = await supabaseAdmin
      .from("campaign_metrics_history")
      .select("platform, recorded_at, spend, impressions, clicks, conversions, revenue, reach")
      .in("campaign_id", campaignIds)
      .gte("recorded_at", since + "T00:00:00.000Z")
      .lte("recorded_at", until + "T23:59:59.999Z")
      .order("recorded_at", { ascending: true })

    if (error) throw error

    // Aggregate by date × platform
    const byDatePlatform: Map<string, Map<string, RawRow>> = new Map()
    const byPlatformTotals: Map<string, { spend: number; impressions: number; clicks: number; conversions: number; revenue: number; reach: number }> = new Map()
    let totSpend = 0, totImp = 0, totClicks = 0, totConv = 0, totRev = 0, totReach = 0

    for (const row of rows ?? []) {
      const date = (row.recorded_at as string).slice(0, 10)
      const platform: string = row.platform ?? "unknown"
      const spend = Number(row.spend ?? 0)
      const impressions = Number(row.impressions ?? 0)
      const clicks = Number(row.clicks ?? 0)
      const conversions = Number(row.conversions ?? 0)
      const revenue = Number(row.revenue ?? 0)
      const reach = Number(row.reach ?? 0)

      // Daily × platform accumulator
      if (!byDatePlatform.has(date)) byDatePlatform.set(date, new Map())
      const dateMap = byDatePlatform.get(date)!
      const existing = dateMap.get(platform)
      if (existing) {
        existing.spend += spend
        existing.impressions += impressions
        existing.clicks += clicks
        existing.conversions += conversions
        existing.revenue += revenue
        existing.reach += reach
      } else {
        dateMap.set(platform, { platform, date, spend, impressions, clicks, conversions, revenue, reach })
      }

      // Per-platform totals
      const pt = byPlatformTotals.get(platform) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, reach: 0 }
      pt.spend += spend; pt.impressions += impressions; pt.clicks += clicks
      pt.conversions += conversions; pt.revenue += revenue; pt.reach += reach
      byPlatformTotals.set(platform, pt)

      // Grand totals
      totSpend += spend; totImp += impressions; totClicks += clicks
      totConv += conversions; totRev += revenue; totReach += reach
    }

    // Build timeseries
    const timeseries: TimeseriesEntry[] = []
    for (const [date, platformMap] of byDatePlatform) {
      let ds = 0, di = 0, dc = 0, dconv = 0, drev = 0, dreach = 0
      const by_platform: Record<string, MetricsTotals> = {}
      for (const [platform, r] of platformMap) {
        ds += r.spend; di += r.impressions; dc += r.clicks
        dconv += r.conversions; drev += r.revenue; dreach += r.reach
        by_platform[platform] = computeKpis(r.spend, r.impressions, r.clicks, r.conversions, r.revenue, r.reach)
      }
      timeseries.push({
        date,
        consolidated: computeKpis(ds, di, dc, dconv, drev, dreach),
        by_platform,
      })
    }

    // Build by_platform summary
    const by_platform: Record<string, MetricsTotals> = {}
    for (const [platform, t] of byPlatformTotals) {
      by_platform[platform] = computeKpis(t.spend, t.impressions, t.clicks, t.conversions, t.revenue, t.reach)
    }

    return {
      period: { since, until },
      consolidated: computeKpis(totSpend, totImp, totClicks, totConv, totRev, totReach),
      by_platform,
      timeseries,
    }
  }
}
