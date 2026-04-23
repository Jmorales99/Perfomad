import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"

export class EnrichCampaignsWithMetrics {
  constructor(private campaignsRepo: SupabaseCampaignsRepository) {}

  async execute(userId: string, clientId?: string) {
    const campaigns = clientId
      ? await this.campaignsRepo.listByUserAndClient(userId, clientId)
      : await this.campaignsRepo.listByUser(userId)

    return campaigns.map((campaign) => {
      if (!campaign.mock_stats) return campaign

      const stats = campaign.mock_stats
      if (typeof stats === 'object' && !Array.isArray(stats)) {
        const platforms = ['meta', 'google_ads', 'linkedin', 'tiktok']
        const hasPlatformKeys = platforms.some(p => p in (stats as object))
        if (hasPlatformKeys) {
          const aggregated = this.aggregatePlatformMetrics(stats as Record<string, any>)
          return { ...campaign, mock_stats: aggregated, spend_usd: aggregated.spend || campaign.spend_usd || 0 }
        }
      }
      return { ...campaign, spend_usd: (stats as any).spend || campaign.spend_usd || 0 }
    })
  }

  // Aggregate metrics from multiple platforms
  private aggregatePlatformMetrics(platformMetrics: Record<string, any>): any {
    const aggregated = {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      total_sales: 0,
      reach: 0,
    }

    for (const platformMetricsData of Object.values(platformMetrics)) {
      if (platformMetricsData && typeof platformMetricsData === 'object') {
        aggregated.spend += platformMetricsData.spend || 0
        aggregated.impressions += platformMetricsData.impressions || 0
        aggregated.clicks += platformMetricsData.clicks || 0
        aggregated.conversions += (platformMetricsData.conversions || 0)
        aggregated.revenue += (platformMetricsData.revenue || 0)
        aggregated.total_sales += (platformMetricsData.total_sales || platformMetricsData.revenue || 0)
        aggregated.reach += (platformMetricsData.reach || 0)
      }
    }

    const ctr = aggregated.impressions > 0 
      ? aggregated.clicks / aggregated.impressions
      : 0
    
    const cpa = aggregated.conversions > 0
      ? aggregated.spend / aggregated.conversions
      : undefined

    const roa = aggregated.spend > 0 && aggregated.revenue > 0
      ? aggregated.revenue / aggregated.spend
      : undefined

    const costPerClick = aggregated.clicks > 0
      ? aggregated.spend / aggregated.clicks
      : undefined

    const cpm = aggregated.impressions > 0
      ? (aggregated.spend / aggregated.impressions) * 1000
      : undefined

    return {
      ...aggregated,
      ctr: Number(ctr.toFixed(4)),
      cpa: cpa ? Number(cpa.toFixed(2)) : undefined,
      roa: roa ? Number(roa.toFixed(2)) : undefined,
      cost_per_click: costPerClick ? Number(costPerClick.toFixed(2)) : undefined,
      cost_per_conversion: cpa ? Number(cpa.toFixed(2)) : undefined,
      cpm: cpm ? Number(cpm.toFixed(2)) : undefined,
    }
  }
}
