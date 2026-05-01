import type { ProductMetricsRepository } from "@/domain/repositories/ProductMetricsRepository"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"

export interface CampaignPresence {
  campaign_id: string
  campaign_name: string | null
  platform: string
  spend: number
  revenue: number
  roas: number
}

export interface GlobalProductRow {
  product_id: string
  product_title: string | null
  image_url: string | null
  platforms: string[]
  campaigns: CampaignPresence[]
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  roas: number
}

export interface GlobalProductMetricsResult {
  products: GlobalProductRow[]
  total_spend: number
  total_revenue: number
  total_roas: number
}

interface CampaignAccumulator {
  campaign_id: string
  platform: string
  spend: number
  revenue: number
}

interface ProductAccumulator {
  product_id: string
  product_title: string | null
  image_url: string | null
  platforms: Set<string>
  campaignMap: Map<string, CampaignAccumulator>
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
}

export class GetAllProductMetrics {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private productMetricsRepo: ProductMetricsRepository
  ) {}

  async execute(
    userId: string,
    clientId: string,
    options?: { since?: string; until?: string; platform?: string }
  ): Promise<GlobalProductMetricsResult> {
    const rows = await this.productMetricsRepo.getAllByClient(userId, clientId, options)

    const byProduct = new Map<string, ProductAccumulator>()

    for (const row of rows) {
      const acc = byProduct.get(row.product_id)
      if (acc) {
        acc.impressions += row.impressions
        acc.clicks += row.clicks
        acc.spend += row.spend
        acc.conversions += row.conversions
        acc.revenue += row.revenue
        acc.platforms.add(row.platform)
        if (!acc.image_url && (row as any).image_url) acc.image_url = (row as any).image_url
        if (row.campaign_id) {
          const existing = acc.campaignMap.get(row.campaign_id)
          if (existing) {
            existing.spend += row.spend
            existing.revenue += row.revenue
          } else {
            acc.campaignMap.set(row.campaign_id, {
              campaign_id: row.campaign_id,
              platform: row.platform,
              spend: row.spend,
              revenue: row.revenue,
            })
          }
        }
      } else {
        const campaignMap = new Map<string, CampaignAccumulator>()
        if (row.campaign_id) {
          campaignMap.set(row.campaign_id, {
            campaign_id: row.campaign_id,
            platform: row.platform,
            spend: row.spend,
            revenue: row.revenue,
          })
        }
        byProduct.set(row.product_id, {
          product_id: row.product_id,
          product_title: row.product_title ?? null,
          image_url: (row as any).image_url ?? null,
          platforms: new Set([row.platform]),
          campaignMap,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          conversions: row.conversions,
          revenue: row.revenue,
        })
      }
    }

    // Enrich campaign names in batch
    const allCampaignIds = new Set<string>()
    for (const acc of byProduct.values()) {
      for (const id of acc.campaignMap.keys()) allCampaignIds.add(id)
    }

    const campaignNames = new Map<string, string | null>()
    await Promise.all(
      Array.from(allCampaignIds).map(async (cid) => {
        try {
          const c = await this.campaignsRepo.findById(userId, cid)
          campaignNames.set(cid, (c as any)?.name ?? null)
        } catch {
          campaignNames.set(cid, null)
        }
      })
    )

    const products: GlobalProductRow[] = Array.from(byProduct.values())
      .map((acc) => {
        const campaigns: CampaignPresence[] = Array.from(acc.campaignMap.values()).map((c) => ({
          campaign_id: c.campaign_id,
          campaign_name: campaignNames.get(c.campaign_id) ?? null,
          platform: c.platform,
          spend: c.spend,
          revenue: c.revenue,
          roas: c.spend > 0 ? c.revenue / c.spend : 0,
        }))
        return {
          product_id: acc.product_id,
          product_title: acc.product_title,
          image_url: acc.image_url,
          platforms: Array.from(acc.platforms),
          campaigns,
          impressions: acc.impressions,
          clicks: acc.clicks,
          spend: acc.spend,
          conversions: acc.conversions,
          revenue: acc.revenue,
          ctr: acc.impressions > 0 ? acc.clicks / acc.impressions : 0,
          cpc: acc.clicks > 0 ? acc.spend / acc.clicks : 0,
          roas: acc.spend > 0 ? acc.revenue / acc.spend : 0,
        }
      })
      .sort((a, b) => b.spend - a.spend)

    const total_spend = products.reduce((s, p) => s + p.spend, 0)
    const total_revenue = products.reduce((s, p) => s + p.revenue, 0)
    const total_roas = total_spend > 0 ? total_revenue / total_spend : 0

    return { products, total_spend, total_revenue, total_roas }
  }
}
