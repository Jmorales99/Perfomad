import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export interface CampaignMetricSnapshot {
  id?: string
  campaign_id: string
  platform?: string
  recorded_at?: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  conversions?: number
  revenue?: number
  total_sales?: number
  cpa?: number
  roa?: number
  cost_per_click?: number
  cost_per_conversion?: number
  cpm?: number
  reach?: number
  raw_data?: any
}

export interface CampaignInsightRecord {
  id?: string
  campaign_id: string
  insights_data: any
  recommendations?: any[]
  calculated_at?: string
  data_source?: string
  is_stale?: boolean
}

export class CampaignMetricsHistoryRepository {
  // ============================================================
  // Metrics History Methods
  // ============================================================

  /**
   * Store a metrics snapshot (historical data)
   */
  async storeSnapshot(snapshot: CampaignMetricSnapshot): Promise<CampaignMetricSnapshot> {
    const { data, error } = await supabaseAdmin
      .from("campaign_metrics_history")
      .insert({
        campaign_id: snapshot.campaign_id,
        platform: snapshot.platform || null,
        recorded_at: snapshot.recorded_at || new Date().toISOString(),
        spend: snapshot.spend,
        impressions: snapshot.impressions,
        clicks: snapshot.clicks,
        ctr: snapshot.ctr,
        conversions: snapshot.conversions || null,
        revenue: snapshot.revenue || null,
        total_sales: snapshot.total_sales || null,
        cpa: snapshot.cpa || null,
        roa: snapshot.roa || null,
        cost_per_click: snapshot.cost_per_click || null,
        cost_per_conversion: snapshot.cost_per_conversion || null,
        cpm: snapshot.cpm || null,
        reach: snapshot.reach || null,
        raw_data: snapshot.raw_data || null,
      })
      .select()
      .single()

    if (error) throw error
    return data as CampaignMetricSnapshot
  }

  /**
   * Store multiple snapshots (for multi-platform campaigns)
   */
  async storeMultipleSnapshots(snapshots: CampaignMetricSnapshot[]): Promise<CampaignMetricSnapshot[]> {
    const { data, error } = await supabaseAdmin
      .from("campaign_metrics_history")
      .insert(
        snapshots.map((s) => ({
          campaign_id: s.campaign_id,
          platform: s.platform || null,
          recorded_at: s.recorded_at || new Date().toISOString(),
          spend: s.spend,
          impressions: s.impressions,
          clicks: s.clicks,
          ctr: s.ctr,
          conversions: s.conversions || null,
          revenue: s.revenue || null,
          total_sales: s.total_sales || null,
          cpa: s.cpa || null,
          roa: s.roa || null,
          cost_per_click: s.cost_per_click || null,
          cost_per_conversion: s.cost_per_conversion || null,
          cpm: s.cpm || null,
          reach: s.reach || null,
          raw_data: s.raw_data || null,
        }))
      )
      .select()

    if (error) throw error
    return data as CampaignMetricSnapshot[]
  }

  /**
   * Get historical metrics for a campaign
   */
  async getHistory(
    campaignId: string,
    options?: {
      platform?: string
      startDate?: string
      endDate?: string
      limit?: number
    }
  ): Promise<CampaignMetricSnapshot[]> {
    let query = supabaseAdmin
      .from("campaign_metrics_history")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("recorded_at", { ascending: false })

    if (options?.platform) {
      query = query.eq("platform", options.platform)
    }

    if (options?.startDate) {
      query = query.gte("recorded_at", options.startDate)
    }

    if (options?.endDate) {
      query = query.lte("recorded_at", options.endDate)
    }

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as CampaignMetricSnapshot[]
  }

  /**
   * Get history for multiple campaigns at once (optimized for dashboard)
   */
  async getHistoryForMultipleCampaigns(
    campaignIds: string[],
    options?: {
      startDate?: string
      endDate?: string
      platforms?: string[]
    }
  ): Promise<CampaignMetricSnapshot[]> {
    if (campaignIds.length === 0) {
      return []
    }

    let query = supabaseAdmin
      .from("campaign_metrics_history")
      .select("*")
      .in("campaign_id", campaignIds)
      .order("recorded_at", { ascending: false })

    if (options?.platforms && options.platforms.length > 0) {
      query = query.in("platform", options.platforms)
    }

    if (options?.startDate) {
      query = query.gte("recorded_at", options.startDate)
    }

    if (options?.endDate) {
      query = query.lte("recorded_at", options.endDate)
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as CampaignMetricSnapshot[]
  }

  /**
   * Get latest snapshot for a campaign
   */
  async getLatestSnapshot(campaignId: string, platform?: string): Promise<CampaignMetricSnapshot | null> {
    let query = supabaseAdmin
      .from("campaign_metrics_history")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("recorded_at", { ascending: false })
      .limit(1)

    if (platform) {
      query = query.eq("platform", platform)
    }

    const { data, error } = await query

    if (error) throw error
    return data?.[0] as CampaignMetricSnapshot | null
  }

  // ============================================================
  // Insights Methods
  // ============================================================

  /**
   * Store campaign insights
   */
  async storeInsights(insight: CampaignInsightRecord): Promise<CampaignInsightRecord> {
    // Use upsert to replace existing insights for the campaign
    const { data, error } = await supabaseAdmin
      .from("campaign_insights")
      .upsert(
        {
          campaign_id: insight.campaign_id,
          insights_data: insight.insights_data,
          recommendations: insight.recommendations || null,
          calculated_at: insight.calculated_at || new Date().toISOString(),
          data_source: insight.data_source || "plai_api",
          is_stale: insight.is_stale || false,
        },
        {
          onConflict: "campaign_id",
        }
      )
      .select()
      .single()

    if (error) throw error
    return data as CampaignInsightRecord
  }

  /**
   * Get stored insights for a campaign
   */
  async getInsights(campaignId: string): Promise<CampaignInsightRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("campaign_insights")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle()

    if (error) throw error
    return data as CampaignInsightRecord | null
  }

  /**
   * Mark insights as stale
   */
  async markInsightsStale(campaignId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("campaign_insights")
      .update({ is_stale: true })
      .eq("campaign_id", campaignId)

    if (error) throw error
  }

  /**
   * Check if insights are stale (older than threshold)
   */
  async areInsightsStale(campaignId: string, thresholdHours: number = 24): Promise<boolean> {
    const insight = await this.getInsights(campaignId)
    if (!insight) return true

    const calculatedAt = new Date(insight.calculated_at || 0)
    const now = new Date()
    const hoursSince = (now.getTime() - calculatedAt.getTime()) / (1000 * 60 * 60)

    return hoursSince > thresholdHours || insight.is_stale === true
  }
}

