import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { ProductMetricRow, ProductMetricsRepository } from "@/domain/repositories/ProductMetricsRepository"

export class SupabaseProductMetricsRepository implements ProductMetricsRepository {
  async upsertRows(rows: ProductMetricRow[]): Promise<void> {
    if (rows.length === 0) return

    const { error } = await supabaseAdmin.from("product_metrics_history").upsert(
      rows.map((r) => ({
        user_id: r.user_id,
        client_id: r.client_id,
        ad_account_id: r.ad_account_id,
        campaign_id: r.campaign_id ?? null,
        platform: r.platform,
        product_id: r.product_id,
        product_title: r.product_title ?? null,
        image_url: r.image_url ?? null,
        recorded_at: r.recorded_at,
        impressions: r.impressions,
        clicks: r.clicks,
        spend: r.spend,
        conversions: r.conversions,
        revenue: r.revenue,
        ctr: r.ctr,
        cpc: r.cpc,
        roas: r.roas,
        raw: r.raw ?? null,
      })),
      { onConflict: "user_id,client_id,ad_account_id,platform,product_id,recorded_at" }
    )

    if (error) throw error
  }

  async getByCampaign(
    campaignId: string,
    options?: { since?: string; until?: string }
  ): Promise<ProductMetricRow[]> {
    let query = supabaseAdmin
      .from("product_metrics_history")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("recorded_at", { ascending: false })

    if (options?.since) query = query.gte("recorded_at", options.since)
    if (options?.until) query = query.lte("recorded_at", options.until)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as ProductMetricRow[]
  }

  async getByAdAccount(
    userId: string,
    clientId: string,
    adAccountId: string,
    platform: string,
    options?: { since?: string; until?: string; campaignId?: string }
  ): Promise<ProductMetricRow[]> {
    let query = supabaseAdmin
      .from("product_metrics_history")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("ad_account_id", adAccountId)
      .eq("platform", platform)
      .order("recorded_at", { ascending: false })

    if (options?.since) query = query.gte("recorded_at", options.since)
    if (options?.until) query = query.lte("recorded_at", options.until)
    if (options?.campaignId) query = query.eq("campaign_id", options.campaignId)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as ProductMetricRow[]
  }

  async getAllByClient(
    userId: string,
    clientId: string,
    options?: { since?: string; until?: string; platform?: string }
  ): Promise<ProductMetricRow[]> {
    let query = supabaseAdmin
      .from("product_metrics_history")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .order("recorded_at", { ascending: false })

    if (options?.platform) query = query.eq("platform", options.platform)
    if (options?.since) query = query.gte("recorded_at", options.since)
    if (options?.until) query = query.lte("recorded_at", options.until)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as ProductMetricRow[]
  }
}
