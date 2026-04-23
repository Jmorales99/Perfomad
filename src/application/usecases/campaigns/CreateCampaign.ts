import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { MetaApiClient } from "@/infrastructure/integrations/platforms/MetaApiClient"
import { MetaCampaignBuilder } from "@/application/services/MetaCampaignBuilder"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export class CreateCampaign {
  private tokenManager: TokenManager
  private auditLogger: AuditLogger

  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private adAccountsRepo: SupabaseAdAccountsRepository
  ) {
    this.tokenManager = new TokenManager()
    this.auditLogger = new AuditLogger()
  }

  async execute(input: {
    userId: string
    clientId?: string
    name: string
    platforms: Platform[]
    description?: string
    
    // Budget Options
    budgetUsd?: number // Daily budget (global fallback)
    lifetimeBudget?: number // Lifetime budget (global fallback)
    platformBudgets?: Partial<Record<string, { budget_type: "daily" | "lifetime"; amount: number }>> // Per-platform overrides
    
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
      optimization_goal?: string
      [key: string]: any
    }

    // Targeting
    targeting?: {
      geoCountries?: string[]
      ageMin?: number
      ageMax?: number
      genders?: string[]
    }

    // Creative (triggers full Meta hierarchy: AdSet + Creative + Ad)
    creative?: {
      pageId?: string
      mediaUrl?: string
      mediaType?: "image" | "video"
      mediaFilename?: string
      headline: string
      primaryText: string
      description?: string
      cta?: string
      link: string
    }

    // Product pricing (for accurate ROA calculation)
    productPrice?: number // Selling price per product unit
    productCost?: number // Production cost per product unit (optional)
  }) {
    // 1. Get user's connected ad accounts
    const adAccounts = await this.adAccountsRepo.findByUserId(input.userId)

    // 2. Create campaign locally first (source of truth)
    const localCampaign = await this.campaignsRepo.create({
      user_id: input.userId,
      client_id: input.clientId ?? null,
      name: input.name,
      platforms: input.platforms,
      description: input.description || "",
      budget_usd: input.budgetUsd ?? 0,
      lifetime_budget: input.lifetimeBudget,
      platform_budgets: (input.platformBudgets as any) ?? null,
      spend_usd: 0,
      status: "active",
      start_date: input.startDate ?? new Date().toISOString(),
      end_date: input.endDate ?? null,
      objective: input.objective,
      billing_event: input.billingEvent,
      bid_strategy: input.bidStrategy,
      special_ad_categories: input.specialAdCategories,
      platform_settings: {
        meta: input.metaSettings,
      },
      product_price: input.productPrice,
      product_cost: input.productCost,
      images: [],
    })

    // 3. Create campaigns on each platform
    const platformCampaignIds: Record<string, string> = {}
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

        // Get platform client
        const client = PlatformApiClientFactory.createClient(platform)

        // Get valid access token
        const accessToken = await this.tokenManager.getValidAccessToken(
          adAccount as any,
          async (refreshToken: string) => {
            return await client.refreshAccessToken(refreshToken)
          }
        )

        // Resolve budget: per-platform config takes priority over global budget
        const pb = input.platformBudgets?.[platform]
        const dailyBudget = pb
          ? (pb.budget_type === "daily" ? pb.amount : undefined)
          : input.budgetUsd
        const lifetimeBudget = pb
          ? (pb.budget_type === "lifetime" ? pb.amount : undefined)
          : input.lifetimeBudget

        // Prepare campaign creation parameters
        const campaignParams: any = {
          adAccountId: adAccount.platform_account_id,
          name: input.name,
          dailyBudget,
          lifetimeBudget,
          objective: input.objective || "OUTCOME_TRAFFIC",
          status: input.status || "PAUSED", // Start paused for safety
          startDate: input.startDate || new Date().toISOString(),
          endDate: input.endDate || null,
        }

        // Platform-specific settings
        if (platform === "meta" && input.metaSettings) {
          Object.assign(campaignParams, input.metaSettings)
        }

        // Create campaign on platform
        const platformResult = await client.createCampaign(campaignParams, accessToken)

        platformCampaignIds[platform] = platformResult.campaignId
        platformMetrics[platform] = platformResult.rawData

        // Meta: if creative data is provided, build full hierarchy (AdSet + Creative + Ad)
        if (
          platform === "meta" &&
          input.creative?.mediaUrl &&
          input.creative.pageId &&
          client instanceof MetaApiClient
        ) {
          const builder = new MetaCampaignBuilder(client)
          const genders =
            input.targeting?.genders
              ?.filter((g) => g !== "all")
              .map((g) => (g === "male" ? 1 : 2)) ?? undefined

          const hierarchy = await builder.build(
            {
              adAccountId: adAccount.platform_account_id,
              pageId: input.creative.pageId,
              campaign: {
                campaignId: platformResult.campaignId,
                name: input.name,
              },
              adSet: {
                name: `${input.name} — AdSet`,
                dailyBudget,
                lifetimeBudget,
                billingEvent: input.billingEvent,
                optimizationGoal: input.metaSettings?.optimization_goal,
                bidStrategy: input.bidStrategy,
                targeting: {
                  geo_locations: input.targeting?.geoCountries?.length
                    ? { countries: input.targeting.geoCountries }
                    : undefined,
                  age_min: input.targeting?.ageMin,
                  age_max: input.targeting?.ageMax,
                  genders,
                },
                startTime: input.startDate,
                endTime: input.endDate,
              },
              creative: {
                headline: input.creative.headline,
                primaryText: input.creative.primaryText,
                description: input.creative.description,
                cta: input.creative.cta,
                link: input.creative.link,
              },
              mediaUrl: input.creative.mediaUrl,
              mediaType: input.creative.mediaType ?? "image",
              mediaFilename: input.creative.mediaFilename,
            },
            accessToken
          )

          // Store hierarchy IDs alongside the campaign for debugging
          platformMetrics[platform] = {
            ...platformResult.rawData,
            _adSetId: hierarchy.adSetId,
            _creativeId: hierarchy.creativeId,
            _adId: hierarchy.adId,
          }
        }

        // Log successful creation
        await this.auditLogger.logPlatformApiCall(
          platform,
          "createCampaign",
          true,
          input.userId,
          adAccount.id
        )
      } catch (error: any) {
        console.error(`Failed to create campaign in ${platform}:`, error)
        errors[platform] = error.message || `Failed to create campaign in ${platform}`
        
        await this.auditLogger.logPlatformApiCall(
          platform,
          "createCampaign",
          false,
          input.userId,
          adAccounts.find((a) => a.platform === platform)?.id,
          error
        )
      }
    }

    // 4. Store RAW data and calculate metrics
    const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
    
    const rawDataByPlatform: Record<string, any> = {}
    const calculatedMetrics: Record<string, any> = {}
    
    for (const [platform, metrics] of Object.entries(platformMetrics)) {
      rawDataByPlatform[platform] = metrics
      
      // Calculate metrics from raw data
      const productPricing = input.productPrice || input.productCost
        ? {
            product_price: input.productPrice,
            product_cost: input.productCost,
          }
        : undefined
      
      calculatedMetrics[platform] = MetricsCalculator.calculateFromRaw(metrics, productPricing)
    }

    // Update local campaign with platform IDs, RAW data, and calculated metrics
    const updated = await this.campaignsRepo.update(input.userId, localCampaign.id, {
      platform_campaign_id: platformCampaignIds, // JSONB
      raw_data_platform: rawDataByPlatform, // Store RAW data
      mock_stats: calculatedMetrics, // Store calculated metrics (keep name for compatibility)
    } as any)

    // Save initial historical snapshot
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
      }
    }

    // Attach errors if any
    if (Object.keys(errors).length > 0) {
      return {
        ...updated,
        _errors: errors,
      }
    }

    return updated
  }
}
