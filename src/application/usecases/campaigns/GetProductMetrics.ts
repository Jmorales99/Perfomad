import type { ProductMetricsRepository, ProductMetricRow } from "@/domain/repositories/ProductMetricsRepository"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"

export interface AggregatedProductRow {
  product_id: string
  product_title: string | null
  image_url: string | null
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  roas: number
}

export interface ProductMetricsResult {
  products: AggregatedProductRow[]
  total_spend: number
  total_revenue: number
  total_roas: number
}

export class GetProductMetrics {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private productMetricsRepo: ProductMetricsRepository
  ) {}

  async execute(
    userId: string,
    campaignId: string,
    options?: { since?: string; until?: string }
  ): Promise<ProductMetricsResult> {
    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaña no encontrada")

    const rows = await this.productMetricsRepo.getByCampaign(campaignId, options)

    // Aggregate multiple rows per product (different dates or platforms)
    const byProduct = new Map<string, AggregatedProductRow>()

    for (const row of rows) {
      const existing = byProduct.get(row.product_id)
      if (existing) {
        existing.impressions += row.impressions
        existing.clicks += row.clicks
        existing.spend += row.spend
        existing.conversions += row.conversions
        existing.revenue += row.revenue
        if (!existing.image_url && (row as any).image_url) existing.image_url = (row as any).image_url
      } else {
        byProduct.set(row.product_id, {
          product_id: row.product_id,
          product_title: row.product_title ?? null,
          image_url: (row as any).image_url ?? null,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          conversions: row.conversions,
          revenue: row.revenue,
          ctr: 0,
          cpc: 0,
          roas: 0,
        })
      }
    }

    const products: AggregatedProductRow[] = Array.from(byProduct.values())
      .map((p) => ({
        ...p,
        ctr: p.impressions > 0 ? p.clicks / p.impressions : 0,
        cpc: p.clicks > 0 ? p.spend / p.clicks : 0,
        roas: p.spend > 0 ? p.revenue / p.spend : 0,
      }))
      .sort((a, b) => b.spend - a.spend)

    const total_spend = products.reduce((s, p) => s + p.spend, 0)
    const total_revenue = products.reduce((s, p) => s + p.revenue, 0)
    const total_roas = total_spend > 0 ? total_revenue / total_spend : 0

    return { products, total_spend, total_revenue, total_roas }
  }
}
