import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"
import { MetricsCalculator } from "@/application/services/MetricsCalculator"

export class SyncCampaignMetrics {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private metricsHistoryRepo: CampaignMetricsHistoryRepository,
    private plaiApi: PlaiApiClient
  ) {}

  async execute(userId: string, campaignId: string) {
    // 1. Get campaign from database
    const campaign = await this.campaignsRepo.findById(userId, campaignId)

    if (!campaign) {
      throw new Error("Campaña no encontrada")
    }

    if (!campaign.mock_campaign_id) {
      throw new Error("La campaña no está vinculada a Plai. Primero debe crearse en la plataforma de publicidad.")
    }

    // 2. Parse Plai campaign IDs (stored as JSON)
    let plaiCampaignIds: Record<string, string>
    try {
      plaiCampaignIds =
        typeof campaign.mock_campaign_id === "string"
          ? JSON.parse(campaign.mock_campaign_id)
          : campaign.mock_campaign_id
    } catch {
      throw new Error("Invalid Plai campaign IDs format")
    }

    // 3. STEP 1: Fetch RAW data from Plai for each platform
    const rawDataByPlatform: Record<string, any> = {}
    const updatedMetrics: Record<string, any> = {}
    let totalSpend = 0
    const snapshotsToStore: any[] = []
    const now = new Date().toISOString()

    // Prepare product pricing options (handle undefined/null values)
    // Safely access product_price and product_cost (they might not exist if migration not run)
    const productPrice = (campaign as any).product_price
    const productCost = (campaign as any).product_cost
    
    const productPricingOptions = {
      product_price: productPrice && typeof productPrice === 'number' && productPrice > 0 
        ? productPrice 
        : undefined,
      product_cost: productCost && typeof productCost === 'number' && productCost > 0
        ? productCost
        : undefined,
    }

    for (const [platform, campaignIdInPlai] of Object.entries(plaiCampaignIds)) {
      try {
        // Fetch RAW data from Plai (no calculations here!)
        const overview = await this.plaiApi.getCampaignOverview(campaignIdInPlai as string)
        
        if (!overview || !overview.rawData) {
          console.error(`No rawData returned from Plai API for campaign ${campaignIdInPlai}`)
          throw new Error(`No data returned from Plai API for platform ${platform}`)
        }

        // STEP 2: Store RAW data
        rawDataByPlatform[platform] = overview.rawData

        // STEP 3: Calculate metrics FROM raw data (using MetricsCalculator)
        // Pass product pricing if available for accurate ROA calculation
        const calculatedMetrics = MetricsCalculator.calculateFromRaw(
          overview.rawData, 
          productPricingOptions.product_price || productPricingOptions.product_cost
            ? productPricingOptions
            : undefined
        )
        
        // Store calculated metrics for current snapshot
        updatedMetrics[platform] = calculatedMetrics
        totalSpend += calculatedMetrics.spend || 0

        // STEP 4: Store historical snapshot with both raw data and calculated metrics
        snapshotsToStore.push({
          campaign_id: campaignId,
          platform,
          recorded_at: now,
          spend: calculatedMetrics.spend,
          impressions: calculatedMetrics.impressions,
          clicks: calculatedMetrics.clicks,
          ctr: calculatedMetrics.ctr,
          conversions: calculatedMetrics.conversions || null,
          revenue: calculatedMetrics.revenue || null,
          total_sales: calculatedMetrics.total_sales || null,
          cpa: calculatedMetrics.cpa || null,
          roa: calculatedMetrics.roa || null,
          cost_per_click: calculatedMetrics.cost_per_click || null,
          cost_per_conversion: calculatedMetrics.cost_per_conversion || null,
          cpm: calculatedMetrics.cpm || null,
          reach: calculatedMetrics.reach || null,
          raw_data: overview.rawData, // Store RAW data for future recalculation
        })
      } catch (error: any) {
        console.error(`Failed to sync metrics for ${platform} (campaignId: ${campaignIdInPlai}):`, error)
        console.error(`Error details:`, {
          message: error.message,
          stack: error.stack,
          platform,
          campaignId: campaignIdInPlai,
        })
        
        // Keep existing metrics if sync fails
        if (campaign.mock_stats && typeof campaign.mock_stats === 'object' && !Array.isArray(campaign.mock_stats)) {
          const platformMetrics = (campaign.mock_stats as Record<string, any>)[platform]
          if (platformMetrics) {
            updatedMetrics[platform] = platformMetrics
          }
        }
      }
    }

    // If no metrics were successfully updated, throw error
    if (Object.keys(updatedMetrics).length === 0) {
      throw new Error("No se pudieron obtener métricas de ninguna plataforma. Verifica que la campaña esté activa en Plai.")
    }

    // 5. Store all historical snapshots
    if (snapshotsToStore.length > 0) {
      try {
        await this.metricsHistoryRepo.storeMultipleSnapshots(snapshotsToStore)
      } catch (error: any) {
        console.error("Failed to store metrics history:", error)
        // Don't fail the sync if history storage fails
      }
    }

    // 6. Update campaign with:
    //    - Calculated metrics (current snapshot)
    //    - RAW data from Plai (for future recalculation)
    const updated = await this.campaignsRepo.update(userId, campaignId, {
      mock_stats: updatedMetrics, // Calculated metrics (for quick access)
      raw_data_plai: rawDataByPlatform, // RAW data (source of truth)
      spend_usd: totalSpend,
      last_synced_at: now,
      sync_status: "synced",
    } as any)

    return updated
  }
}
