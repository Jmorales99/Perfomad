import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { EnrichCampaignsWithMetrics } from "./EnrichCampaignsWithMetrics"

export class GetDashboardMetrics {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private enrichCampaigns?: EnrichCampaignsWithMetrics
  ) {}

  async execute(userId: string, campaigns?: any[], clientId?: string) {
    // 1. Get all campaigns for the user (enriched with metrics if available)
    const userCampaigns = campaigns || (this.enrichCampaigns
      ? await this.enrichCampaigns.execute(userId, clientId)
      : clientId
        ? await this.campaignsRepo.listByUserAndClient(userId, clientId)
        : await this.campaignsRepo.listByUser(userId))

    // 2. Calculate aggregated metrics
    const totalCampaigns = userCampaigns.length
    const activeCampaigns = userCampaigns.filter((c) => c.status === "active").length
    const pausedCampaigns = userCampaigns.filter((c) => c.status === "paused").length
    const completedCampaigns = userCampaigns.filter((c) => c.status === "completed").length

    // 3. Calculate total spend and budget
    const totalSpend = userCampaigns.reduce((sum, c) => sum + (c.spend_usd || 0), 0)
    const totalBudget = userCampaigns.reduce((sum, c) => sum + (c.budget_usd || 0), 0)

    // 4. Aggregate metrics from mock_stats
    let totalImpressions = 0
    let totalClicks = 0
    let totalConversions = 0
    let totalRevenue = 0
    let totalSales = 0

    userCampaigns.forEach((campaign) => {
      if (campaign.mock_stats) {
        const stats = campaign.mock_stats as any
        
        // Check if it's multi-platform format: { meta: {...}, google_ads: {...} }
        const platforms = ['meta', 'google_ads', 'linkedin', 'tiktok']
        const hasPlatformKeys = typeof stats === 'object' && !Array.isArray(stats) && 
          platforms.some(p => p in stats)
        
        if (hasPlatformKeys) {
          // Multi-platform format: { meta: {...}, google_ads: {...} }
          Object.values(stats).forEach((platformStats: any) => {
            if (platformStats && typeof platformStats === 'object') {
              if (platformStats.impressions) {
                totalImpressions += platformStats.impressions
              }
              if (platformStats.clicks) {
                totalClicks += platformStats.clicks
              }
              if (platformStats.conversions) {
                totalConversions += platformStats.conversions
              }
              if (platformStats.revenue) {
                totalRevenue += platformStats.revenue
              }
              if (platformStats.total_sales) {
                totalSales += platformStats.total_sales
              } else if (platformStats.revenue) {
                totalSales += platformStats.revenue
              }
            }
          })
        } else if (typeof stats === "object" && !Array.isArray(stats)) {
          // Flat structure: { impressions: 100, clicks: 10, ... }
          if (stats.impressions) {
            totalImpressions += stats.impressions
          }
          if (stats.clicks) {
            totalClicks += stats.clicks
          }
          if (stats.conversions) {
            totalConversions += stats.conversions
          }
          if (stats.revenue) {
            totalRevenue += stats.revenue
          }
          if (stats.total_sales) {
            totalSales += stats.total_sales
          } else if (stats.revenue) {
            totalSales += stats.revenue
          }
        }
      }
    })

    // 5. Calculate derived metrics
    const averageCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const averageCPC = totalClicks > 0 ? totalSpend / totalClicks : 0
    const averageCPM = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
    const averageCPA = totalConversions > 0 ? totalSpend / totalConversions : undefined
    const overallROA = totalSpend > 0 ? totalRevenue / totalSpend : undefined

    // 6. Get recent campaigns (last 5)
    const recentCampaigns = userCampaigns
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        platforms: c.platforms,
        spend_usd: c.spend_usd,
        budget_usd: c.budget_usd,
        created_at: c.created_at,
      }))

    // 7. Calculate platform distribution
    const platformCounts: Record<string, number> = {}
    userCampaigns.forEach((c) => {
      c.platforms.forEach((platform: string) => {
        platformCounts[platform] = (platformCounts[platform] || 0) + 1
      })
    })

    return {
      summary: {
        total_campaigns: totalCampaigns,
        active_campaigns: activeCampaigns,
        paused_campaigns: pausedCampaigns,
        completed_campaigns: completedCampaigns,
        total_spend: totalSpend,
        total_budget: totalBudget,
        budget_utilization: totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0,
      },
      metrics: {
        total_impressions: totalImpressions,
        total_clicks: totalClicks,
        total_conversions: totalConversions,
        total_revenue: totalRevenue,
        total_sales: totalSales || totalRevenue,
        average_ctr: averageCTR,
        average_cpc: averageCPC,
        average_cpm: averageCPM,
        average_cpa: averageCPA,
        overall_roa: overallROA,
      },
      recent_campaigns: recentCampaigns,
      platform_distribution: platformCounts,
    }
  }
}

