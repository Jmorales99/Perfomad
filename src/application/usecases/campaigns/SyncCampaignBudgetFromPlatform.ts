import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { OptimizationConfigRepository } from "@/infrastructure/repositories/OptimizationConfigRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

export type SourceOfTruth = "local" | "platform"

export interface SyncBudgetResult {
  campaign_id: string
  platform: string | null
  local_daily: number | null
  local_lifetime: number | null
  platform_daily: number | null
  platform_lifetime: number | null
  drift_pct: number | null
  budget_sync_status: "in_sync" | "drifted" | "unknown" | "error"
  source_of_truth: SourceOfTruth
  spend_platform: number | null
  error?: string
}

export class SyncCampaignBudgetFromPlatform {
  private tokenManager = new TokenManager()
  private auditLogger = new AuditLogger()

  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly adAccountsRepo: SupabaseAdAccountsRepository,
    private readonly configRepo: OptimizationConfigRepository
  ) {}

  /**
   * Reads current budget + spend from the platform and updates the campaign row.
   * When `promoteToSourceOfTruth = true`, the platform budget becomes the
   * source of truth and is copied into the local_* columns.
   */
  async execute(
    userId: string,
    campaignId: string,
    options?: { promoteToSourceOfTruth?: boolean }
  ): Promise<SyncBudgetResult> {
    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaign not found")

    const platforms = Array.isArray(campaign.platforms) ? campaign.platforms : []
    const primaryPlatform = (platforms[0] || "meta") as Platform

    const platformCampaignId = resolvePlatformCampaignId(campaign, primaryPlatform)
    if (!platformCampaignId) {
      return this.persistError(userId, campaignId, primaryPlatform, campaign, "not_linked")
    }

    const adAccount = await this.adAccountsRepo.findByUserClientAndPlatform(
      userId,
      (campaign as any).client_id,
      primaryPlatform
    )
    if (!adAccount) {
      return this.persistError(userId, campaignId, primaryPlatform, campaign, "no_ad_account")
    }

    const config = await this.configRepo.get()
    let snapshot
    try {
      const client = PlatformApiClientFactory.createClient(primaryPlatform)
      const accessToken = await this.tokenManager.getValidAccessToken(
        adAccount as any,
        async (refresh) => client.refreshAccessToken(refresh)
      )
      snapshot = await client.getCampaignBudget(platformCampaignId, accessToken, {
        platformAccountId: adAccount.platform_account_id,
      })

      await this.auditLogger.logPlatformApiCall(
        primaryPlatform,
        "getCampaignBudget",
        true,
        userId,
        adAccount.id
      )
    } catch (err: any) {
      await this.auditLogger.logPlatformApiCall(
        primaryPlatform,
        "getCampaignBudget",
        false,
        userId,
        adAccount.id,
        err
      )
      return this.persistError(
        userId,
        campaignId,
        primaryPlatform,
        campaign,
        err?.message ?? "api_error"
      )
    }

    const localDaily =
      (campaign as any).budget_local_daily ?? (campaign as any).budget_usd ?? null
    const localLifetime =
      (campaign as any).budget_local_lifetime ?? (campaign as any).lifetime_budget ?? null

    const platformDaily = snapshot.daily_budget
    const platformLifetime = snapshot.lifetime_budget
    const driftPct = computeDriftPct(Number(localDaily), platformDaily)
    const threshold = config.budget_drift_threshold_pct
    const syncStatus =
      driftPct === null
        ? "unknown"
        : Math.abs(driftPct) <= threshold
          ? "in_sync"
          : "drifted"

    const promote = !!options?.promoteToSourceOfTruth
    const nowIso = new Date().toISOString()

    const updates: Record<string, unknown> = {
      budget_platform_daily: platformDaily,
      budget_platform_lifetime: platformLifetime,
      budget_drift_pct: driftPct,
      budget_sync_status: syncStatus,
      budget_last_synced_at: nowIso,
      spend_platform: snapshot.spend_to_date,
      spend_last_synced_at: nowIso,
    }

    if (promote) {
      updates.budget_source_of_truth = "platform"
      if (platformDaily !== null) {
        updates.budget_local_daily = platformDaily
        updates.budget_usd = platformDaily
      }
      if (platformLifetime !== null) {
        updates.budget_local_lifetime = platformLifetime
        updates.lifetime_budget = platformLifetime
      }
      updates.budget_sync_status = "in_sync"
    }

    await this.campaignsRepo.update(userId, campaignId, updates as any)

    return {
      campaign_id: campaignId,
      platform: primaryPlatform,
      local_daily: promote ? platformDaily : localDaily !== null ? Number(localDaily) : null,
      local_lifetime: promote
        ? platformLifetime
        : localLifetime !== null
          ? Number(localLifetime)
          : null,
      platform_daily: platformDaily,
      platform_lifetime: platformLifetime,
      drift_pct: promote ? 0 : driftPct,
      budget_sync_status: promote ? "in_sync" : syncStatus,
      source_of_truth: promote
        ? "platform"
        : (((campaign as any).budget_source_of_truth as SourceOfTruth) || "platform"),
      spend_platform: snapshot.spend_to_date,
    }
  }

  private async persistError(
    userId: string,
    campaignId: string,
    platform: string | null,
    campaign: any,
    error: string
  ): Promise<SyncBudgetResult> {
    await this.campaignsRepo.update(userId, campaignId, {
      budget_sync_status: "error",
      budget_last_synced_at: new Date().toISOString(),
    } as any)

    return {
      campaign_id: campaignId,
      platform,
      local_daily: numberOrNull(campaign.budget_local_daily ?? campaign.budget_usd),
      local_lifetime: numberOrNull(campaign.budget_local_lifetime ?? campaign.lifetime_budget),
      platform_daily: null,
      platform_lifetime: null,
      drift_pct: null,
      budget_sync_status: "error",
      source_of_truth:
        (campaign.budget_source_of_truth as SourceOfTruth | undefined) ?? "platform",
      spend_platform: null,
      error,
    }
  }
}

function resolvePlatformCampaignId(campaign: any, platform: string): string | null {
  const field = campaign.platform_campaign_id || campaign.mock_campaign_id
  if (!field) return null
  try {
    const parsed = typeof field === "string" ? JSON.parse(field) : field
    return parsed?.[platform] ?? null
  } catch {
    return null
  }
}

function computeDriftPct(local: number | null, platform: number | null): number | null {
  if (local === null || platform === null || platform === 0 || Number.isNaN(local)) {
    return null
  }
  const pct = Math.abs(local - platform) / platform * 100
  return Number(pct.toFixed(2))
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
