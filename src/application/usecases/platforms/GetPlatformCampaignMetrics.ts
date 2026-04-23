import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import type { AdAccount, AdAccountsRepository, Platform } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import { resolveAdAccountByPlatformId } from "@/application/usecases/platforms/resolveAdAccountByPlatformId"

export interface CampaignMetricsItem {
  campaign_id: string
  name: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  ctr: number
  cpc: number
  cpm: number
  /** Normalized campaign status: 'active' | 'paused' | 'removed' | 'unknown' */
  status?: string
  /** Purchases derived from actions[action_type=purchase]. 0 if no purchase actions. */
  conversions: number
  /** Purchase revenue derived from action_values[action_type=purchase]. 0 if unavailable. */
  revenue: number
  cpa: number | undefined
  roas: number | undefined
  actions: Array<{ action_type: string; value: string }>
  action_values: Array<{ action_type: string; value: string }>
}

export interface PlatformCampaignMetricsResult {
  account: Pick<AdAccount, "id" | "platform_account_id" | "account_name" | "currency" | "connected_at" | "last_synced_at">
  campaigns: CampaignMetricsItem[]
  dateRange: { since: string; until: string }
}

/**
 * Fetches per-campaign insights (level=campaign) from the platform API for a specific
 * ad account that belongs to the given user + brand (clientId).
 *
 * Campaigns are ordered by spend descending (server-side sort when supported).
 *
 * adAccountId resolution:
 *   1. Matched against platform_account_id directly or with act_ normalisation.
 *   2. Auto-selected when the brand has exactly one active account for the platform.
 *   3. Error asking to specify when there are multiple accounts and no adAccountId given.
 */
export class GetPlatformCampaignMetrics {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private tokenManager: TokenManager,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(
    userId: string,
    clientId: string,
    platform: Platform,
    adAccountId: string | undefined,
    dateRange?: { since: string; until: string }
  ): Promise<PlatformCampaignMetricsResult> {
    // Validate brand ownership
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    // Resolve target ad account
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

    // Obtain a valid (possibly refreshed) access token
    const platformClient = PlatformApiClientFactory.createClient(platform)
    const accessToken = await this.tokenManager.getValidAccessToken(
      account,
      async (refreshToken: string) => platformClient.refreshAccessToken(refreshToken)
    )

    // Fetch per-campaign insights
    const rows = await platformClient.getAdAccountCampaignInsights(
      account.platform_account_id,
      accessToken,
      effectiveDateRange
    )

    // Map raw rows to structured CampaignMetricsItem, deriving conversions/revenue
    const campaigns: CampaignMetricsItem[] = rows.map((row) => {
      const conversions = row.actions
        .filter((a) => a.action_type === "purchase")
        .reduce((sum, a) => sum + parseInt(a.value, 10), 0)

      const revenue = row.action_values
        .filter((a) => a.action_type === "purchase")
        .reduce((sum, a) => sum + parseFloat(a.value), 0)

      const cpa = conversions > 0 ? row.spend / conversions : undefined
      const roas = row.spend > 0 ? revenue / row.spend : undefined

      return {
        campaign_id: row.campaign_id,
        name: row.name,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        reach: row.reach,
        ctr: row.ctr,
        cpc: row.cpc,
        cpm: row.cpm,
        status: row.status,
        conversions,
        revenue,
        cpa,
        roas,
        actions: row.actions,
        action_values: row.action_values,
      }
    })

    // Guarantee spend-descending order even if the platform didn't sort
    campaigns.sort((a, b) => b.spend - a.spend)

    return {
      account: {
        id: account.id,
        platform_account_id: account.platform_account_id,
        account_name: account.account_name,
        currency: account.currency,
        connected_at: account.connected_at,
        last_synced_at: account.last_synced_at,
      },
      campaigns,
      dateRange: effectiveDateRange,
    }
  }
}
