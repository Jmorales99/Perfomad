import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { CampaignMetricsHistoryRepository, type CampaignMetricSnapshot } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { MetricsCalculator } from "@/application/services/MetricsCalculator"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { isReconnectRequired } from "@/infrastructure/integrations/platforms/OAuthErrorDetector"

export class SyncCampaignMetrics {
  private tokenManager: TokenManager
  private auditLogger: AuditLogger
  private adAccountsRepo: SupabaseAdAccountsRepository

  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private metricsHistoryRepo: CampaignMetricsHistoryRepository
  ) {
    this.tokenManager = new TokenManager()
    this.auditLogger = new AuditLogger()
    this.adAccountsRepo = new SupabaseAdAccountsRepository()
  }

  async execute(userId: string, campaignId: string) {
    // 1. Get campaign from database
    const campaign = await this.campaignsRepo.findById(userId, campaignId)

    if (!campaign) {
      throw new Error("Campaña no encontrada")
    }

    // 2. Get platform campaign IDs (support both old and new field names)
    let platformCampaignIds: Record<string, string>
    const campaignIdField = (campaign as any).platform_campaign_id || (campaign as any).mock_campaign_id
    
    if (!campaignIdField) {
      throw new Error("La campaña no está vinculada a ninguna plataforma. Primero debe crearse en la plataforma de publicidad.")
    }

    try {
      platformCampaignIds =
        typeof campaignIdField === "string"
          ? JSON.parse(campaignIdField)
          : campaignIdField
    } catch {
      throw new Error("Invalid platform campaign IDs format")
    }

    // 3. Get user's ad accounts for token access
    const adAccounts = await this.adAccountsRepo.findByUserId(userId)
    const adAccountsByPlatform = new Map<Platform, typeof adAccounts[0]>()
    for (const account of adAccounts) {
      adAccountsByPlatform.set(account.platform, account)
    }

    // 4. Fetch RAW data from platform APIs for each platform
    const rawDataByPlatform: Record<string, any> = {}
    const updatedMetrics: Record<string, any> = {}
    let totalSpend = 0
    const dailySnapshotsToUpsert: CampaignMetricSnapshot[] = []
    const now = new Date().toISOString()
    // 30 days balances completeness vs. rate-limit cost per sync.
    // Full backfill on import covers the rest of the campaign lifetime.
    const SYNC_LOOKBACK_DAYS = 30
    const since = (() => { const d = new Date(); d.setDate(d.getDate() - SYNC_LOOKBACK_DAYS); return d.toISOString().slice(0, 10) })()
    const until = new Date().toISOString().slice(0, 10)

    // Accumulated from the best-effort budget block (last platform wins for single-platform campaigns)
    let platformStatus: string | null = null
    let budgetPlatformDaily: number | null = null
    let budgetPlatformLifetime: number | null = null
    let budgetDriftPct: number | null = null
    let budgetSyncStatus: string | null = null
    let spendPlatform: number | null = null

    // Prepare product pricing options
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

    for (const [platform, platformCampaignId] of Object.entries(platformCampaignIds)) {
      try {
        const platformKey = platform as Platform

        // Get ad account for this platform
        const adAccount = adAccountsByPlatform.get(platformKey)
        if (!adAccount) {
          console.error(`No ad account found for platform ${platform}`)
          continue
        }

        // Get platform client
        const client = PlatformApiClientFactory.createClient(platformKey)

        // Get valid access token
        const accessToken = await this.tokenManager.getValidAccessToken(
          adAccount as any,
          async (refreshToken: string) => {
            return await client.refreshAccessToken(refreshToken)
          }
        )

        // Fetch metrics from platform API
        const platformMetrics = await client.getCampaignMetrics(
          platformCampaignId as string,
          accessToken,
          { platformAccountId: adAccount.platform_account_id }
        )
        
        if (!platformMetrics) {
          console.error(`No metrics returned from platform API for campaign ${platformCampaignId}`)
          throw new Error(`No data returned from platform API for platform ${platform}`)
        }

        // Best-effort: also pull current budget snapshot from the platform so we
        // can detect drift vs. the local budget. Failures are non-fatal.
        try {
          const budgetSnapshot = await client.getCampaignBudget(
            platformCampaignId as string,
            accessToken,
            { platformAccountId: adAccount.platform_account_id }
          )
          const localDaily = Number((campaign as any).budget_local_daily ?? (campaign as any).budget_usd)
          const platformDaily = budgetSnapshot.daily_budget
          let driftPct: number | null = null
          let syncStatus: "in_sync" | "drifted" | "unknown" = "unknown"
          if (platformDaily !== null && Number.isFinite(localDaily) && platformDaily > 0) {
            driftPct = Number(((Math.abs(localDaily - platformDaily) / platformDaily) * 100).toFixed(2))
            syncStatus = driftPct <= 5 ? "in_sync" : "drifted"
          }
          Object.assign(rawDataByPlatform, {
            [`${platform}__budget`]: {
              daily_budget: budgetSnapshot.daily_budget,
              lifetime_budget: budgetSnapshot.lifetime_budget,
              spend_to_date: budgetSnapshot.spend_to_date,
              drift_pct: driftPct,
              sync_status: syncStatus,
            },
          })
          // Capture for final campaign update
          if (budgetSnapshot.status) platformStatus = budgetSnapshot.status
          budgetPlatformDaily = budgetSnapshot.daily_budget
          budgetPlatformLifetime = budgetSnapshot.lifetime_budget
          budgetDriftPct = driftPct
          budgetSyncStatus = syncStatus
          spendPlatform = budgetSnapshot.spend_to_date
        } catch (budgetErr) {
          console.warn(
            `[SyncCampaignMetrics] Could not sync budget for ${platform}:`,
            budgetErr instanceof Error ? budgetErr.message : String(budgetErr)
          )
        }

        // Store RAW data
        rawDataByPlatform[platform] = platformMetrics

        // Calculate metrics from raw data
        const calculatedMetrics = MetricsCalculator.calculateFromRaw(
          platformMetrics,
          productPricingOptions.product_price || productPricingOptions.product_cost
            ? productPricingOptions
            : undefined
        )
        
        // Store calculated metrics
        updatedMetrics[platform] = calculatedMetrics
        totalSpend += calculatedMetrics.spend || 0

        // Fetch daily insights for last 30 days and queue for idempotent upsert
        const dailyRows = await client.getCampaignDailyInsights(
          platformCampaignId as string,
          accessToken,
          { platformAccountId: adAccount.platform_account_id, since, until }
        ).catch(() => [])

        for (const row of dailyRows) {
          dailySnapshotsToUpsert.push({
            campaign_id: campaignId,
            platform,
            recorded_at: row.date + "T12:00:00.000Z",
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            conversions: row.conversions,
            revenue: row.revenue,
            reach: row.reach,
            cpa: row.conversions > 0 ? row.spend / row.conversions : undefined,
            roa: row.spend > 0 && row.revenue > 0 ? row.revenue / row.spend : undefined,
            cost_per_click: row.cpc,
            cpm: row.cpm,
          })
        }

        // Log successful sync and reset connection status
        await this.auditLogger.logPlatformApiCall(
          platformKey,
          "getCampaignMetrics",
          true,
          userId,
          adAccount.id
        )
        await this.adAccountsRepo.markConnectionStatus(adAccount.user_id, adAccount.id, "connected").catch(() => {})
      } catch (error: any) {
        console.error(`Failed to sync metrics for ${platform} (campaignId: ${platformCampaignId}):`, error)

        // Mark ad account connection status so the frontend can prompt reconnection
        const platformKey = platform as Platform
        const adAccount = adAccountsByPlatform.get(platformKey)
        if (adAccount) {
          const connStatus = isReconnectRequired(error) ? "reconnect_required" : "error"
          await this.adAccountsRepo.markConnectionStatus(adAccount.user_id, adAccount.id, connStatus).catch(() => {})
        }

        // Keep existing metrics if sync fails
        const statsField = (campaign as any).mock_stats || (campaign as any).platform_stats
        if (statsField && typeof statsField === 'object' && !Array.isArray(statsField)) {
          const platformMetrics = (statsField as Record<string, any>)[platform]
          if (platformMetrics) {
            updatedMetrics[platform] = platformMetrics
          }
        }

        // Log error
        await this.auditLogger.logPlatformApiCall(
          platformKey,
          "getCampaignMetrics",
          false,
          userId,
          adAccount?.id,
          error
        )
      }
    }

    // If no metrics were successfully updated, throw error
    if (Object.keys(updatedMetrics).length === 0) {
      throw new Error("No se pudieron obtener métricas de ninguna plataforma. Verifica que la campaña esté activa.")
    }

    // 5. Upsert daily snapshots (idempotent — safe to call on every sync)
    if (dailySnapshotsToUpsert.length > 0) {
      try {
        await this.metricsHistoryRepo.bulkUpsertDailySnapshots(dailySnapshotsToUpsert)
      } catch (error: any) {
        console.error("Failed to upsert daily metrics history:", error)
      }
    }

    // 6. Update campaign with calculated metrics, RAW data, status, and budget
    const updated = await this.campaignsRepo.update(userId, campaignId, {
      mock_stats: updatedMetrics, // Keep name for backward compatibility
      raw_data_platform: rawDataByPlatform, // New field name
      raw_data_plai: rawDataByPlatform, // Keep old name for backward compatibility
      spend_usd: totalSpend,
      last_synced_at: now,
      sync_status: "synced",
      // Status from platform (null for TikTok/unsupported — field left unchanged)
      ...(platformStatus ? { status: platformStatus } : {}),
      // Budget columns — only written when the platform returned real values
      ...(budgetPlatformDaily !== null ? {
        budget_platform_daily: budgetPlatformDaily,
        budget_platform_lifetime: budgetPlatformLifetime,
        budget_drift_pct: budgetDriftPct,
        budget_sync_status: budgetSyncStatus,
        spend_platform: spendPlatform,
      } : {}),
    } as any)

    return updated
  }
}
