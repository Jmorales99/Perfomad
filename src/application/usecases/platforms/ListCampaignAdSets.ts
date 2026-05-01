import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { MerchantCenterApiClient } from "@/infrastructure/integrations/platforms/MerchantCenterApiClient"
import type { MerchantProduct } from "@/infrastructure/integrations/platforms/MerchantCenterApiClient"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import type { AdDetail, AdSetSummary } from "@/infrastructure/integrations/platforms/PlatformApiClient"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"
import { env } from "@/config/env"

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

    const { platform, platformCampaignId, adAccount, clientId } = resolved
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

      // Shopping campaigns return a single placeholder with merchant_id set.
      // Enrich it with real product images from Merchant Center when connected.
      const shoppingPlaceholder = platform === "google_ads"
        ? ads.find((ad) => ad.creative?.merchant_id != null)
        : undefined

      if (shoppingPlaceholder) {
        let enriched: AdDetail[] | null = null
        try {
          enriched = await this.enrichShoppingWithProducts(
            userId,
            clientId,
            shoppingPlaceholder.creative.merchant_id!
          )
        } catch (enrichErr: any) {
          // MC enrichment failed — fall through to return placeholder as-is
        }
        if (enriched !== null) {
          await this.auditLogger.logPlatformApiCall(platform, "listAdSetAds", true, userId, adAccount.id)
          return { platform, ads: enriched }
        }
        // MC not connected or enrichment failed — return placeholder as-is
      }

      await this.auditLogger.logPlatformApiCall(platform, "listAdSetAds", true, userId, adAccount.id)
      return { platform, ads }
    } catch (err) {
      await this.auditLogger.logPlatformApiCall(platform, "listAdSetAds", false, userId, adAccount.id, err)
      throw err
    }
  }

  private async enrichShoppingWithProducts(
    userId: string,
    clientId: string,
    merchantId: string
  ): Promise<AdDetail[] | null> {
    const mcAccount = await this.adAccountsRepo.findByUserClientAndPlatform(
      userId,
      clientId,
      "google_merchant_center"
    )
    if (!mcAccount) return null

    const mcClient = new MerchantCenterApiClient({
      clientId: env.GOOGLE_ADS_CLIENT_ID || "",
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || "",
      redirectUri: env.GOOGLE_MC_REDIRECT_URI || "",
    })

    const mcToken = await this.tokenManager.getValidAccessToken(
      mcAccount as any,
      async (refresh) => mcClient.refreshAccessToken(refresh)
    )

    const effectiveMerchantId = (mcAccount as any).platform_account_id || merchantId
    const products = await mcClient.listProducts(effectiveMerchantId, mcToken, { maxResults: 50 })
    if (products.length === 0) return null

    return products.map(mcProductToAdDetail)
  }
}

interface ResolvedCampaignContext {
  platform: Platform
  platformCampaignId: string
  adAccount: { id: string; platform_account_id?: string }
  clientId: string
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

    return {
      platform: primaryPlatform,
      platformCampaignId,
      adAccount: adAccount as any,
      clientId: (campaign as any).client_id,
    }
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
    clientId: options.clientId,
  }
}

function resolvePlatformCampaignId(campaign: any, platform: string): string | null {
  const field = campaign.platform_campaign_id
  if (!field) return null
  try {
    const parsed = typeof field === "string" ? JSON.parse(field) : field
    return parsed?.[platform] ?? null
  } catch {
    return null
  }
}

function mcProductToAdDetail(product: MerchantProduct): AdDetail {
  return {
    ad_id: product.id,
    name: product.title,
    status: "ENABLED",
    effective_status: "ACTIVE",
    creative: {
      creative_id: product.id,
      type: "image",
      thumbnail_url: product.imageLink ?? null,
      image_url: product.imageLink ?? null,
      video_url: null,
      cards: [],
      ad_type: "SHOPPING_PRODUCT_AD",
    } as any,
  }
}
