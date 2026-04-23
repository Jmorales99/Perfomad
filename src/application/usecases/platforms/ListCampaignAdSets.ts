import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import type { AdDetail, AdSetSummary } from "@/infrastructure/integrations/platforms/PlatformApiClient"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}

/** Fills `metrics` when platforms only return flat spend/impressions/clicks (Meta, Google, etc.). */
function withNormalizedAdSetMetrics(adsets: AdSetSummary[]): AdSetSummary[] {
  return adsets.map((a) => {
    const impressions = a.impressions ?? 0
    const clicks = a.clicks ?? 0
    const spend = a.spend ?? 0
    return {
      ...a,
      metrics: a.metrics ?? { impressions, clicks, spend },
    }
  })
}

export interface AdSetLookupOptions {
  dateRange?: { since: string; until: string }
  /**
   * When the caller provides a platform-native campaign id (not a UUID in our DB),
   * these must be provided to resolve the correct ad account + access token.
   */
  clientId?: string
  platform?: Platform
}

export class ListCampaignAdSets {
  private tokenManager = new TokenManager()
  private auditLogger = new AuditLogger()

  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly adAccountsRepo: SupabaseAdAccountsRepository
  ) {}

  async execute(
    userId: string,
    campaignId: string,
    options?: AdSetLookupOptions
  ): Promise<{ platform: string; adsets: AdSetSummary[] }> {
    const resolved = await resolveCampaignContext(
      this.campaignsRepo,
      this.adAccountsRepo,
      userId,
      campaignId,
      options
    )
    if (!resolved) return { platform: options?.platform ?? "meta", adsets: [] }

    const { platform, platformCampaignId, adAccount } = resolved
    const client = PlatformApiClientFactory.createClient(platform)
    const accessToken = await this.tokenManager.getValidAccessToken(
      adAccount as any,
      async (refresh) => client.refreshAccessToken(refresh)
    )

    try {
      const adsets = await client.listCampaignAdSets(platformCampaignId, accessToken, {
        platformAccountId: (adAccount as any).platform_account_id,
        dateRange: options?.dateRange,
      })
      await this.auditLogger.logPlatformApiCall(
        platform,
        "listCampaignAdSets",
        true,
        userId,
        adAccount.id
      )
      return { platform, adsets: withNormalizedAdSetMetrics(adsets) }
    } catch (err) {
      await this.auditLogger.logPlatformApiCall(
        platform,
        "listCampaignAdSets",
        false,
        userId,
        adAccount.id,
        err
      )
      throw err
    }
  }
}

export class ListAdSetAds {
  private tokenManager = new TokenManager()
  private auditLogger = new AuditLogger()

  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly adAccountsRepo: SupabaseAdAccountsRepository
  ) {}

  /**
   * `campaignId` is required to resolve the ad account / tokens, since ad sets
   * themselves are not directly linked to a user in our DB. Accepts either a
   * UUID (internal campaign row) or a platform-native id with `clientId`+`platform`.
   */
  async execute(
    userId: string,
    campaignId: string,
    adSetId: string,
    options?: { clientId?: string; platform?: Platform }
  ): Promise<{ platform: string; ads: AdDetail[] }> {
    const resolved = await resolveCampaignContext(
      this.campaignsRepo,
      this.adAccountsRepo,
      userId,
      campaignId,
      options
    )
    if (!resolved) return { platform: options?.platform ?? "meta", ads: [] }

    const { platform, platformCampaignId, adAccount } = resolved
    const client = PlatformApiClientFactory.createClient(platform)
    const accessToken = await this.tokenManager.getValidAccessToken(
      adAccount as any,
      async (refresh) => client.refreshAccessToken(refresh)
    )

    try {
      const ads = await client.listAdSetAds(adSetId, accessToken, {
        platformAccountId: (adAccount as any).platform_account_id,
        campaignId: platformCampaignId ?? undefined,
      })
      await this.auditLogger.logPlatformApiCall(
        platform,
        "listAdSetAds",
        true,
        userId,
        adAccount.id
      )
      return { platform, ads }
    } catch (err) {
      await this.auditLogger.logPlatformApiCall(
        platform,
        "listAdSetAds",
        false,
        userId,
        adAccount.id,
        err
      )
      throw err
    }
  }
}

interface ResolvedCampaignContext {
  platform: Platform
  platformCampaignId: string
  adAccount: { id: string; platform_account_id?: string }
}

/**
 * Resolves campaign context to a (platform, platform-native campaign id, ad account)
 * tuple. Supports two modes:
 *   1. UUID in our DB → uses the campaign row + its stored `platform_campaign_id`.
 *   2. Platform-native id (non-UUID) → requires `clientId`+`platform` in options
 *      and looks up the ad account directly.
 */
async function resolveCampaignContext(
  campaignsRepo: SupabaseCampaignsRepository,
  adAccountsRepo: SupabaseAdAccountsRepository,
  userId: string,
  campaignId: string,
  options?: { clientId?: string; platform?: Platform }
): Promise<ResolvedCampaignContext | null> {
  if (isUuid(campaignId)) {
    const campaign = await campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaign not found")

    const platforms = Array.isArray(campaign.platforms) ? campaign.platforms : []
    const primaryPlatform = (options?.platform || platforms[0] || "meta") as Platform

    const platformCampaignId = resolvePlatformCampaignId(campaign, primaryPlatform)
    if (!platformCampaignId) return null

    const adAccount = await adAccountsRepo.findByUserClientAndPlatform(
      userId,
      (campaign as any).client_id,
      primaryPlatform
    )
    if (!adAccount) return null

    return { platform: primaryPlatform, platformCampaignId, adAccount: adAccount as any }
  }

  // Platform-native id flow
  if (!options?.clientId || !options?.platform) {
    throw new Error(
      "Invalid campaign id: expected UUID, or provide clientId+platform for platform-native id"
    )
  }

  const adAccount = await adAccountsRepo.findByUserClientAndPlatform(
    userId,
    options.clientId,
    options.platform
  )
  if (!adAccount) return null

  return {
    platform: options.platform,
    platformCampaignId: campaignId,
    adAccount: adAccount as any,
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
