import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export class CreateCampaign {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private adAccountsRepo: SupabaseAdAccountsRepository,
    private plaiApi: PlaiApiClient
  ) {}

  async execute(input: {
    userId: string
    plaiUserId: string
    name: string
    platforms: Platform[]
    description?: string
    
    // Budget Options
    budgetUsd?: number // Daily budget
    lifetimeBudget?: number // Alternative: lifetime budget
    
    // Campaign Settings
    objective?: string // OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_ENGAGEMENT, etc.
    billingEvent?: string // IMPRESSIONS, LINK_CLICKS, etc.
    bidStrategy?: string // LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
    status?: "ACTIVE" | "PAUSED"
    specialAdCategories?: string[] // HOUSING, EMPLOYMENT, CREDIT
    
    // Dates
    startDate?: string
    endDate?: string | null
    
    // Platform-specific settings
    metaSettings?: {
      promoted_object?: any
      [key: string]: any
    }
    
    // Product pricing (for accurate ROA calculation)
    productPrice?: number // Selling price per product unit
    productCost?: number // Production cost per product unit (optional)
  }) {
    // 1. Get user's connected ad accounts
    const adAccounts = await this.adAccountsRepo.findByUserId(input.userId)

    // 2. Create campaign locally first (source of truth) with all platform-specific fields
    const localCampaign = await this.campaignsRepo.create({
      user_id: input.userId,
      name: input.name,
      platforms: input.platforms,
      description: input.description || "",
      budget_usd: input.budgetUsd ?? 0,
      lifetime_budget: input.lifetimeBudget,
      spend_usd: 0,
      status: "active",
      start_date: input.startDate ?? new Date().toISOString(),
      end_date: input.endDate ?? null,
      // Meta-specific fields
      objective: input.objective,
      billing_event: input.billingEvent,
      bid_strategy: input.bidStrategy,
      special_ad_categories: input.specialAdCategories,
      // Platform-specific settings
      platform_settings: {
        meta: input.metaSettings,
      },
      // Product pricing
      product_price: input.productPrice,
      product_cost: input.productCost,
      images: [],
    })

    // 3. Create campaigns in Plai for each platform
    const plaiCampaignIds: Record<string, string> = {}
    const platformMetrics: Record<string, any> = {}
    const errors: Record<string, string> = {}

    for (const platform of input.platforms) {
      try {
        // Find ad account for this platform
        const adAccount = adAccounts.find(
          (acc) => acc.platform === platform && acc.is_active
        )

        if (!adAccount) {
          errors[platform] = `No active ad account found for platform: ${platform}`
          continue
        }

        // Prepare platform-specific campaign creation parameters
        const campaignParams: any = {
          ad_account_id: adAccount.platform_account_id,
          name: input.name,
          objective: input.objective || "OUTCOME_TRAFFIC",
          billing_event: input.billingEvent || "IMPRESSIONS",
          bid_strategy: input.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
          status: input.status || "ACTIVE",
          start_time: input.startDate || new Date().toISOString(),
          end_time: input.endDate || null,
        }

        // Budget: Use daily_budget or lifetime_budget (not both)
        if (input.budgetUsd) {
          campaignParams.daily_budget = input.budgetUsd
        } else if (input.lifetimeBudget) {
          campaignParams.lifetime_budget = input.lifetimeBudget
        } else {
          // Default if neither provided
          campaignParams.daily_budget = 100
        }

        // Special ad categories (for compliance)
        if (input.specialAdCategories && input.specialAdCategories.length > 0) {
          campaignParams.special_ad_categories = input.specialAdCategories
        }

        // Platform-specific settings (e.g., Meta promoted_object)
        if (platform === "meta" && input.metaSettings) {
          Object.assign(campaignParams, input.metaSettings)
        }

        // Create in Plai with realistic parameters
        const plaiResult = await this.plaiApi.createCampaign(campaignParams)

        plaiCampaignIds[platform] = plaiResult.campaign_id
        
        // Store RAW data from Plai (source of truth)
        // Use rawData if available, fallback to metrics for backward compatibility
        platformMetrics[platform] = plaiResult.rawData || plaiResult.metrics
      } catch (error: any) {
        console.error(`Failed to create campaign in ${platform}:`, error)
        errors[platform] = error.message || `Failed to create campaign in ${platform}`
      }
    }

    // 4. Store RAW data and calculate metrics
    const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
    
    // Prepare raw data storage
    const rawDataByPlatform: Record<string, any> = {}
    const calculatedMetrics: Record<string, any> = {}
    
    for (const [platform, metrics] of Object.entries(platformMetrics)) {
      // Store RAW data (source of truth)
      rawDataByPlatform[platform] = metrics
      
      // Calculate metrics from raw data
      calculatedMetrics[platform] = MetricsCalculator.calculateFromRaw(metrics)
    }

    // Update local campaign with Plai IDs, RAW data, and calculated metrics
    const updated = await this.campaignsRepo.update(input.userId, localCampaign.id, {
      mock_campaign_id: JSON.stringify(plaiCampaignIds),
      raw_data_plai: rawDataByPlatform, // Store RAW data
      mock_stats: calculatedMetrics, // Store calculated metrics
    } as any)

    // Save initial historical snapshot for each platform
    if (Object.keys(calculatedMetrics).length > 0) {
      const { CampaignMetricsHistoryRepository } = await import("@/infrastructure/repositories/CampaignMetricsHistoryRepository")
      const metricsHistoryRepo = new CampaignMetricsHistoryRepository()
      
      const snapshotsToStore = Object.entries(calculatedMetrics).map(([platform, metrics]: [string, any]) => ({
        campaign_id: localCampaign.id,
        platform,
        recorded_at: new Date().toISOString(),
        spend: metrics.spend || 0,
        impressions: metrics.impressions || 0,
        clicks: metrics.clicks || 0,
        ctr: metrics.ctr || 0,
        conversions: metrics.conversions,
        revenue: metrics.revenue,
        total_sales: metrics.total_sales,
        cpa: metrics.cpa,
        roa: metrics.roa,
        cost_per_click: metrics.cost_per_click,
        cost_per_conversion: metrics.cost_per_conversion,
        cpm: metrics.cpm,
        reach: metrics.reach,
        raw_data: rawDataByPlatform[platform] || null,
      }))
      
      try {
        await metricsHistoryRepo.storeMultipleSnapshots(snapshotsToStore)
      } catch (error) {
        console.error("Error saving initial historical snapshot:", error)
        // Don't fail campaign creation if snapshot save fails
      }
    }

    // If there were errors, attach them to the response
    if (Object.keys(errors).length > 0) {
      return {
        ...updated,
        _errors: errors,
      }
    }

    return updated
  }
}
