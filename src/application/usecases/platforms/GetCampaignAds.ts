import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import type { AdCreative } from "@/infrastructure/integrations/platforms/PlatformApiClient"
import type { AdAccount, AdAccountsRepository, Platform } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import { resolveAdAccountByPlatformId } from "@/application/usecases/platforms/resolveAdAccountByPlatformId"

export interface AdMetrics {
  spend: number
  impressions: number
  clicks: number
  reach: number
  ctr: number
  cpc: number
  cpm: number
  /** Purchase conversions derived from actions[action_type=purchase]. 0 when unavailable. */
  conversions: number
  /** Purchase revenue from action_values[action_type=purchase]. 0 when unavailable. */
  revenue: number
  cpa: number | undefined
  roas: number | undefined
}

export interface AdWithMetrics {
  ad_id: string
  name: string
  status: string
  effective_status: string
  creative: AdCreative
  metrics: AdMetrics
}

export interface GetCampaignAdsResult {
  account: Pick<AdAccount, "id" | "platform_account_id" | "account_name" | "currency">
  campaignId: string
  dateRange: { since: string; until: string }
  ads: AdWithMetrics[]
}

const ZERO_METRICS: AdMetrics = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  ctr: 0,
  cpc: 0,
  cpm: 0,
  conversions: 0,
  revenue: 0,
  cpa: undefined,
  roas: undefined,
}

/**
 * Fetches all ads in a campaign together with their creative metadata (URLs only,
 * no file downloads) and per-ad Insights for the requested date range.
 *
 * Both API calls (ads + insights) are made in parallel for efficiency.
 * Ads with no insight data in the period are returned with zeroed metrics.
 * Results are ordered by spend descending.
 */
export class GetCampaignAds {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private tokenManager: TokenManager,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(
    userId: string,
    clientId: string,
    platform: Platform,
    campaignId: string,
    adAccountId: string | undefined,
    dateRange?: { since: string; until: string }
  ): Promise<GetCampaignAdsResult> {
    // Validate brand ownership
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    // Resolve target ad account (same pattern as sibling usecases)
    const allForClient = await this.adAccountsRepo.findByUserAndClient(userId, clientId)
    const platformAccounts = allForClient.filter((a) => a.platform === platform && a.is_active)

    if (platformAccounts.length === 0) {
      throw new Error(`No connected ${platform} accounts for this brand. Connect an account first.`)
    }

    let account: AdAccount
    if (adAccountId) {
      const found = resolveAdAccountByPlatformId(platform, platformAccounts, adAccountId)
      if (!found) {
        throw new Error("Ad account not found or does not belong to this brand. Check adAccountId.")
      }
      account = found
    } else if (platformAccounts.length === 1) {
      account = platformAccounts[0]
    } else {
      const ids = platformAccounts.map((a) => a.platform_account_id).join(", ")
      throw new Error(
        `Multiple ${platform} accounts found for this brand. Specify adAccountId. Available: ${ids}`
      )
    }

    // Build effective date range (default: last 30 days)
    const until = dateRange?.until ?? new Date().toISOString().slice(0, 10)
    const since = dateRange?.since ?? (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.toISOString().slice(0, 10)
    })()
    const effectiveDateRange = { since, until }

    // Refresh token if needed
    const platformClient = PlatformApiClientFactory.createClient(platform)
    const accessToken = await this.tokenManager.getValidAccessToken(
      account,
      async (refreshToken: string) => platformClient.refreshAccessToken(refreshToken)
    )

    // Google Ads requires the customer ID to be encoded alongside the campaign ID
    // so getCampaignAds can POST to the correct customers/{id}/googleAds:search endpoint.
    // Strip dashes that may appear in the UI representation (e.g. "123-456-7890").
    const googleCustomerId = account.platform_account_id.replace(/-/g, "")
    const effectiveCampaignId =
      platform === "google_ads" ? `${googleCustomerId}:${campaignId}` : campaignId

    // Fetch ads list and insights in parallel
    const [adDetails, insightRows] = await Promise.all([
      platformClient.getCampaignAds(effectiveCampaignId, accessToken, {
        platformAccountId: account.platform_account_id,
      }),
      platformClient.getAdInsights(
        account.platform_account_id,
        effectiveCampaignId,
        accessToken,
        effectiveDateRange
      ),
    ])

    // Index insights by ad_id for O(1) lookup
    const insightsMap = new Map(insightRows.map((row) => [row.ad_id, row]))

    // Merge ad details + metrics
    const ads: AdWithMetrics[] = adDetails.map((ad) => {
      const row = insightsMap.get(ad.ad_id)

      if (!row) {
        return { ...ad, metrics: { ...ZERO_METRICS } }
      }

      // Google Ads reports conversions under action_type "conversion";
      // Meta uses "purchase" (and sometimes "omni_purchase").
      const conversionTypes =
        platform === "google_ads" ? ["conversion"] : ["purchase", "omni_purchase"]

      const conversions = row.actions
        .filter((a) => conversionTypes.includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value, 10), 0)

      const revenue = row.action_values
        .filter((a) => conversionTypes.includes(a.action_type))
        .reduce((sum, a) => sum + parseFloat(a.value), 0)

      const cpa = conversions > 0 ? row.spend / conversions : undefined
      const roas = row.spend > 0 ? revenue / row.spend : undefined

      return {
        ...ad,
        metrics: {
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          reach: row.reach,
          ctr: row.ctr,
          cpc: row.cpc,
          cpm: row.cpm,
          conversions,
          revenue,
          cpa,
          roas,
        },
      }
    })

    // Order by spend descending (ads with no insight data sink to the bottom)
    ads.sort((a, b) => b.metrics.spend - a.metrics.spend)

    return {
      account: {
        id: account.id,
        platform_account_id: account.platform_account_id,
        account_name: account.account_name,
        currency: account.currency,
      },
      campaignId,
      dateRange: effectiveDateRange,
      ads,
    }
  }
}
