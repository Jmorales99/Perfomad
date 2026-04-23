import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import type { AccountInsights } from "@/infrastructure/integrations/platforms/PlatformApiClient"
import type { AdAccount, AdAccountsRepository, Platform } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import { resolveAdAccountByPlatformId } from "@/application/usecases/platforms/resolveAdAccountByPlatformId"

export interface PlatformAccountMetricsResult {
  account: Pick<AdAccount, "id" | "platform_account_id" | "account_name" | "currency" | "is_active" | "connected_at" | "last_synced_at">
  metrics: AccountInsights
  dateRange: { since: string; until: string }
}

/**
 * Fetches real account-level insights from the platform API for a specific
 * ad account that belongs to the given user + brand (clientId).
 *
 * adAccountId resolution (in order):
 *   1. Matched against platform_account_id directly.
 *   2. Matched with the "act_" prefix stripped/added (Meta normalisation).
 *   3. If undefined and only one account exists → auto-selected.
 *   4. If undefined and multiple accounts exist → error asking to specify.
 */
export class GetPlatformAccountMetrics {
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
  ): Promise<PlatformAccountMetricsResult> {
    // Validate brand ownership
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    // Resolve target ad account
    const allForClient = await this.adAccountsRepo.findByUserAndClient(userId, clientId)
    const metaAccounts = allForClient.filter((a) => a.platform === platform && a.is_active)

    if (metaAccounts.length === 0) {
      throw new Error(`No connected ${platform} accounts for this brand. Connect an account first.`)
    }

    let account: AdAccount
    if (adAccountId) {
      const found = resolveAdAccountByPlatformId(platform, metaAccounts, adAccountId)
      if (!found) {
        throw new Error(
          "Ad account not found or does not belong to this brand. Check adAccountId."
        )
      }
      account = found
    } else if (metaAccounts.length === 1) {
      account = metaAccounts[0]
    } else {
      const ids = metaAccounts.map((a) => a.platform_account_id).join(", ")
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

    // Call the platform Insights API
    const metrics = await platformClient.getAccountInsights(
      account.platform_account_id,
      accessToken,
      effectiveDateRange
    )

    return {
      account: {
        id: account.id,
        platform_account_id: account.platform_account_id,
        account_name: account.account_name,
        currency: account.currency,
        is_active: account.is_active,
        connected_at: account.connected_at,
        last_synced_at: account.last_synced_at,
      },
      metrics,
      dateRange: effectiveDateRange,
    }
  }
}
