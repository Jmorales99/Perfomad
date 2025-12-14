import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"

export class EnrichCampaignsWithMetrics {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private plaiApi: PlaiApiClient
  ) {}

  async execute(userId: string) {
    // 1. Get all campaigns from database
    const campaigns = await this.campaignsRepo.listByUser(userId)

    // 2. Enrich each campaign with metrics
    // Use stored mock_stats if available, otherwise fetch or generate
    const enrichedCampaigns = await Promise.all(
      campaigns.map(async (campaign) => {
        // Check if campaign already has stored metrics (from database)
        // mock_stats can be stored as:
        // 1. Per-platform: {"meta": {...}, "google_ads": {...}}
        // 2. Flat structure: {...} (legacy or aggregated)
        
        if (campaign.mock_stats) {
          // Campaign has stored metrics - use them
          // If it's per-platform, aggregate or use first platform
          let stats = campaign.mock_stats
          
          if (typeof stats === 'object' && !Array.isArray(stats)) {
            // Check if it's per-platform structure
            const platforms = ['meta', 'google_ads', 'linkedin']
            const hasPlatformKeys = platforms.some(p => stats && typeof stats === 'object' && p in stats)
            
            if (hasPlatformKeys && typeof stats === 'object') {
              // Per-platform structure - aggregate metrics from all platforms
              const aggregated = this.aggregatePlatformMetrics(stats as Record<string, any>)
              return {
                ...campaign,
                mock_stats: aggregated,
                spend_usd: aggregated.spend || campaign.spend_usd || 0,
              }
            } else {
              // Flat structure - use as is
              return {
                ...campaign,
                mock_stats: stats,
                spend_usd: (stats as any).spend || campaign.spend_usd || 0,
              }
            }
          }
        }

        // If campaign has mock_campaign_id but no stored metrics, fetch fresh
        if (campaign.mock_campaign_id) {
          try {
            // Parse Plai campaign IDs (stored as JSON)
            let plaiCampaignIds: Record<string, string> | string
            try {
              plaiCampaignIds =
                typeof campaign.mock_campaign_id === "string"
                  ? JSON.parse(campaign.mock_campaign_id)
                  : campaign.mock_campaign_id
            } catch {
              // Legacy format - single campaign ID
              plaiCampaignIds = campaign.mock_campaign_id as string
            }

            // Get metrics from first platform (or single ID)
            const campaignId =
              typeof plaiCampaignIds === "string"
                ? plaiCampaignIds
                : Object.values(plaiCampaignIds)[0]

            if (campaignId) {
              const overview = await this.plaiApi.getCampaignOverview(campaignId)
              
              // Return enriched campaign with fresh metrics from API
              return {
                ...campaign,
                mock_stats: overview.metrics,
                spend_usd: overview.metrics.spend || campaign.spend_usd,
              }
            }
          } catch (error: any) {
            console.error(`Failed to fetch metrics for campaign ${campaign.id}:`, error)
            // If API fails, generate mock metrics based on campaign ID
          }
        }

        // If campaign doesn't have mock_campaign_id or API failed, generate mock metrics
        // This ensures ALL campaigns have data
        const mockMetrics = this.generateMockMetrics(campaign.id, campaign)
        return {
          ...campaign,
          mock_stats: mockMetrics,
          spend_usd: mockMetrics.spend || campaign.spend_usd || 0,
        }
      })
    )

    return enrichedCampaigns
  }

  // Generate mock metrics for campaigns without mock_campaign_id
  // Uses campaign ID as seed for consistent random data
  // NOTE: Revenue is only calculated if product_price is provided (real data)
  private generateMockMetrics(campaignId: string, campaign?: any) {
    // Use campaign ID as seed for consistent random data
    let hash = 0
    for (let i = 0; i < campaignId.length; i++) {
      const char = campaignId.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    const seed = Math.abs(hash) / 2147483647

    const conversions = Math.floor(seed * 100) + 5
    const spend = Number((seed * 1000).toFixed(2))
    
    // Calculate revenue ONLY if product_price is provided (real data from user)
    // DO NOT invent revenue - it should come from API or user input
    let revenue = 0
    let totalSales = 0
    if (campaign?.product_price && conversions > 0) {
      revenue = Number((conversions * campaign.product_price).toFixed(2))
      totalSales = revenue
    }
    
    // Calculate profit if product_cost is also provided
    let profit: number | undefined = undefined
    if (campaign?.product_cost !== undefined && conversions > 0 && revenue > 0) {
      const totalProductCost = conversions * campaign.product_cost
      profit = revenue - totalProductCost
    }
    
    // Calculate CPA (Cost Per Acquisition)
    const cpa = conversions > 0 ? Number((spend / conversions).toFixed(2)) : undefined
    
    // Calculate ROA (Return on Advertising)
    // If profit is available, use profit-based ROA (more accurate)
    // Otherwise, use revenue-based ROA if revenue exists
    let roa: number | undefined = undefined
    if (spend > 0) {
      if (profit !== undefined) {
        roa = Number((profit / spend).toFixed(2))
      } else if (revenue > 0) {
        roa = Number((revenue / spend).toFixed(2))
      }
    }

    return {
      impressions: Math.floor(seed * 50000) + 1000,
      clicks: Math.floor(seed * 2000) + 50,
      ctr: Number((seed * 5).toFixed(4)) / 100, // CTR as decimal (0.05 = 5%)
      spend,
      conversions,
      revenue,
      total_sales: totalSales,
      profit,
      cpa,
      roa,
      cost_per_click: Number((seed * 3).toFixed(2)),
      cost_per_conversion: cpa,
      reach: Math.floor(seed * 30000) + 5000,
      cpm: Number((seed * 10 + 2).toFixed(2)),
    }
  }

  // Aggregate metrics from multiple platforms into a single metrics object
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

    // Sum metrics from all platforms
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

    // Calculate derived metrics
    const ctr = aggregated.impressions > 0 
      ? (aggregated.clicks / aggregated.impressions) * 100 
      : 0
    
    const cpa = aggregated.conversions > 0
      ? aggregated.spend / aggregated.conversions
      : undefined

    const roa = aggregated.spend > 0
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

